/* ════════════════════════════════════════════════════════════════
 * BrainSlap — content/interventions.js  v1.0 (실적용판)
 * 사용자 행동 제어 및 개입(Intervention) 모듈 · 담당 파트
 * ----------------------------------------------------------------
 * [역할]
 *  background.js 가 AI 판정(score < 5) 후 보내는 BRAINSLAP_BLOCK
 *  메시지를 받아, 실제 웹페이지 위에 개입 UI를 주입한다.
 *
 * [설계 원칙]
 *  · Shadow DOM(closed) 주입 — 호스트 페이지 CSS/JS와 완전 격리.
 *  · 페이지 이벤트(스크롤 등) 하이재킹 금지 — 오버레이/CSS만 사용.
 *  · 판정 파이프라인(app.py)의 reason 을 잔소리 소재로 재활용.
 *  · 잔소리 생성 AI 연동 지점: say() 함수 — 추후 /nagging API 응답으로 교체.
 *
 * [메시지 프로토콜]  (background.js 와 합의된 인터페이스)
 *  수신: {type:'BRAINSLAP_BLOCK',  interventionId, goal, reason, score, persona}
 *  수신: {type:'BRAINSLAP_SESSION_RESULT', perfect, minutes, baseReward, jackpot}
 *  송신: {type:'BRAINSLAP_EVENT', id, action, payload}   → 로그/통계
 *  송신: {type:'BRAINSLAP_CLOSE_TAB'}                    → 딴짓 탭 종료
 * ════════════════════════════════════════════════════════════════ */
(() => {
  if (window.__brainslapLoaded) return;   // 중복 주입 방지
  window.__brainslapLoaded = true;

  /* ─────────────── Shadow DOM 호스트 구축 ─────────────── */
  const HOST_TAG = 'brainslap-root';
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'all:initial; position:fixed; inset:0; z-index:2147483647; pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  (document.documentElement || document.body).appendChild(host);

  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}
    *{margin:0; padding:0; box-sizing:border-box; font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; letter-spacing:-.01em}
    button{cursor:pointer; font-family:inherit}
    #iv-root{position:fixed; inset:0; pointer-events:none}
    #iv-root > *{pointer-events:auto}
    @keyframes bsFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes bsPopIn{from{opacity:0; transform:translateY(12px) scale(.97)}to{opacity:1; transform:none}}
    @keyframes bsSlideUp{from{transform:translateY(90px); opacity:0}to{transform:none; opacity:1}}
    @keyframes bsSpin{to{transform:rotate(360deg)}}
    .iv-dim{position:fixed; inset:0; background:rgba(8,8,12,.62); backdrop-filter:blur(4px);
      display:grid; place-items:center; animation:bsFadeIn .25s ease}
    .iv-card{width:min(92vw,420px); background:#fff; border-radius:16px; padding:22px;
      box-shadow:0 24px 60px rgba(0,0,0,.4); animation:bsPopIn .3s cubic-bezier(.2,.9,.3,1.2); color:#171717}
    .iv-card h3{font-size:17px; font-weight:800}
    .iv-card .sub{font-size:13px; color:#555; margin-top:7px; line-height:1.55}
    .iv-primary{width:100%; padding:12px; border:none; border-radius:10px; margin-top:15px;
      background:#171717; color:#fff; font-weight:700; font-size:14px; transition:transform .12s}
    .iv-primary:hover{transform:translateY(-1px)}
    .iv-ghost{width:100%; padding:11px; border:1px solid #e5e5e5; border-radius:10px; margin-top:8px;
      background:#fff; color:#555; font-weight:600; font-size:13px}
    .iv-toast{position:fixed; left:50%; bottom:34px; transform:translateX(-50%);
      background:rgba(15,15,18,.94); color:#fff; font-size:13px; font-weight:600;
      padding:11px 18px; border-radius:99px; white-space:nowrap; animation:bsPopIn .25s ease;
      box-shadow:0 10px 30px rgba(0,0,0,.35); max-width:92vw; overflow:hidden; text-overflow:ellipsis}
    /* 푸시 알림 */
    .noti{position:fixed; right:18px; bottom:20px; width:min(88vw,340px);
      background:rgba(24,24,28,.94); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,.08);
      border-radius:15px; padding:11px 13px; display:flex; gap:10px; align-items:center; color:#fff;
      cursor:pointer; animation:bsSlideUp .45s cubic-bezier(.2,.9,.3,1.2); transition:transform .15s}
    .noti:hover{transform:translateY(-2px)}
    .n-icon{width:36px; height:36px; border-radius:9px; display:grid; place-items:center; font-size:18px; flex:none}
    .n-body{flex:1; min-width:0}
    .n-app{font-size:10px; color:rgba(255,255,255,.55); display:flex; justify-content:space-between}
    .n-title{font-size:12.5px; font-weight:700; margin-top:1px}
    .n-preview{font-size:12px; color:rgba(255,255,255,.82); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
    /* DM 채팅창 */
    .dm-window{position:fixed; right:18px; bottom:18px; width:min(90vw,350px);
      animation:bsSlideUp .35s cubic-bezier(.2,.9,.3,1.15)}
    .dm-window.takeover{top:24px; left:24px; right:24px; bottom:24px; width:auto;
      animation:bsPopIn .4s cubic-bezier(.2,.9,.3,1.1)}
    .dm-window > div{background:#fff; border-radius:16px; box-shadow:0 18px 50px rgba(0,0,0,.4); overflow:hidden}
    .dm-window.takeover > div{height:100%; display:flex; flex-direction:column}
    .dm-head{display:flex; align-items:center; gap:9px; padding:11px 15px; border-bottom:1px solid #eee}
    .dm-body{padding:13px 15px; display:flex; flex-direction:column; gap:8px; min-height:74px; color:#171717}
    .dm-window.takeover .dm-body{flex:1; overflow-y:auto}
    .dm-replies{display:none; gap:8px; padding:0 15px 13px}
    .dm-bubble{align-self:flex-start; max-width:85%; background:#f1f2f4; border-radius:4px 14px 14px 14px;
      padding:9px 13px; font-size:13px; animation:bsPopIn .2s ease; line-height:1.5}
    /* 가짜 OS 알림 */
    .fake-alert{position:fixed; width:min(80vw,270px); background:#f4f4f6; border-radius:11px;
      box-shadow:0 16px 44px rgba(0,0,0,.45); overflow:hidden; animation:bsPopIn .22s cubic-bezier(.2,.9,.3,1.3)}
    .fa-bar{height:27px; background:#e6e6ea; display:flex; align-items:center; gap:5px; padding:0 10px}
    .fa-bar i{width:9px; height:9px; border-radius:50%}
    .fa-bar i:nth-child(1){background:#ff5f57}.fa-bar i:nth-child(2){background:#febc2e}.fa-bar i:nth-child(3){background:#28c840}
    .fa-bar b{font-size:10px; color:#666; margin-left:4px}
    .fa-body{padding:14px; font-size:12.5px; color:#222; line-height:1.55}
    .fa-btn{display:block; width:calc(100% - 26px); margin:0 13px 13px; padding:9px;
      border:none; border-radius:8px; background:#5046e5; color:#fff; font-weight:700; font-size:12.5px}
    .buf-ring{width:48px; height:48px; border-radius:50%; border:4px solid rgba(255,255,255,.25);
      border-top-color:#fff; animation:bsSpin .8s linear infinite; margin:0 auto 15px}
    .pill{position:fixed; top:20px; left:50%; transform:translateX(-50%);
      background:rgba(15,15,18,.92); color:#fff; border-radius:99px; padding:9px 9px 9px 16px;
      display:flex; align-items:center; gap:11px; font-size:12.5px; animation:bsPopIn .3s ease; white-space:nowrap; max-width:94vw}
    .pill button{border:none; border-radius:99px; padding:7px 14px; font-size:12px; font-weight:700; background:#fff; color:#111}
    .wheel{width:100%; height:100%; border-radius:50%; border:5px solid #fff;
      box-shadow:0 6px 24px rgba(0,0,0,.25), inset 0 0 0 2px rgba(0,0,0,.08);
      transition:transform 3.6s cubic-bezier(.12,.68,.16,1)}
  `;
  shadow.appendChild(style);
  const root = document.createElement('div');
  root.id = 'iv-root';
  shadow.appendChild(root);

  /* ─────────────── 페르소나 대사 템플릿 ───────────────
   * [잔소리 AI 연동 지점] 팀원의 잔소리 생성 파이프라인(/nagging)이
   * 준비되면 say()가 API 응답 텍스트를 반환하도록 교체.
   * 현재는 로컬 템플릿 + 판정 reason 을 조합해 사용. */
  /* ─────────────── 페르소나 (페르소나 파트와 키 통일: 한글 5종 + 자유 입력) ───────────────
   * 메인 잔소리는 백엔드 /analyze·/nagging 이 생성한 실제 텍스트(ctx.nag)를 사용.
   * 아래 로컬 템플릿은 ① 백엔드 미커버 상황(도주 대사·읽씹 항의·칭찬·협상 멘트)
   * ② 네트워크 실패 폴백 전용. */
  const PERSONA_META = {
    '교관':        { icon:'🎖️', color:'#3f6212' },
    '엄마':        { icon:'🍳', color:'#9d174d' },
    '사극_왕장군': { icon:'⚔️', color:'#7c4a02' },
    '면접관':      { icon:'🧐', color:'#1e3a8a' },
    '츤데레':      { icon:'😤', color:'#7c2d92' },
  };
  const TEMPLATES = {
    '교관': {
      nudge:'동작 그만! {goal} 한다며 지금 뭘 보고 있나!',
      runaway:['종료? 아직 훈련 안 끝났다.', '어딜 도망가! 버튼도 너한테 실망했다.', '…포기가 이렇게 빠르면 목표도 못 이룬다.'],
      ghosted:'읽씹…? 훈련병이 간부 메시지를 읽씹해?!',
      praise:'좋다! 그게 바로 정예 요원의 자세다.',
      negotiate:'휴식도 작전이다. 단, 시간 엄수. 알겠나?' },
    '엄마': {
      nudge:'얘~ 그거 이따 엄마랑 같이 보자. 지금은 {goal} 해야지?',
      runaway:['어머, 종료 누르게? 엄마 서운해~', '한 번만 더 누르면 반찬 없다?', '…알았어, 근데 엄마 진짜 서운해. (한숨)'],
      ghosted:'어머, 읽고 씹었어? 엄마 카톡을? 서운함이 이만저만이 아니야.',
      praise:'아이고 기특해라! 이따 맛있는 거 해줄게.',
      negotiate:'그래, 쉬는 것도 필요하지. 근데 딱 정한 만큼만이야?' },
    '사극_왕장군': {
      nudge:'멈추어라! {goal}을(를) 두고 어딜 한눈파는 겐가!',
      runaway:['멈추어라! 어명이다.', '어허! 과인의 눈을 피할 셈이냐.', '…그 끈기, 전장에서 썼다면 장수가 되었을 것을.'],
      ghosted:'과인의 서찰을 읽고도 답이 없다? 이는 항명이렷다!',
      praise:'장하다! 그대야말로 이 시대의 충신이로다.',
      negotiate:'휴식을 청하는가. 좋다, 허나 약조한 시간은 지켜야 할 것이야.' },
    '면접관': {
      nudge:'이력서의 "성실함"… 방금 이 페이지 앞에서 증명 실패하셨네요.',
      runaway:['종료 버튼을 누르시는 근거가 무엇인가요?', '그 판단, 5년 뒤의 본인도 동의할까요?', '…탈락 사유에 추가하겠습니다.'],
      ghosted:'방금 제 메시지를 확인하고 무시하셨네요. 평가표에 기록하겠습니다.',
      praise:'좋은 판단이네요. 합격에 가까워지고 있습니다.',
      negotiate:'휴식 요청이요? 조건을 명확히 하시죠.' },
    '츤데레': {
      nudge:'벌써 딴짓하러 온 거야? …뭐, 네가 그렇지.',
      runaway:['흥, 종료하든가. …안 누를 거잖아.', '자, 잠깐! 진짜 누르려고?', '…가지 마. (작게)'],
      ghosted:'이, 읽씹…? 하, 별로 신경 안 쓰거든. (5초마다 확인 중)',
      praise:'뭐, 뭐야. 제법이잖아…! 따, 딱히 감동한 건 아니고.',
      negotiate:'쉬고 싶으면 쉬어. 대신 약속은 지켜. 알았지?' },
  };
  // 자유 입력 페르소나(예: "능글맞은 선배처럼 말해줘")용 중립 템플릿
  const GENERIC = {
    nudge:'{goal} 하기로 했잖아요. 지금 이 페이지, 맞는 길일까요?',
    runaway:['정말 종료하시게요?', '한 번 더 생각해봐요.', '…알겠어요, 선택은 존중할게요.'],
    ghosted:'메시지 읽으신 거 다 보여요. 답이 없으시네요?',
    praise:'좋아요, 그 선택 멋졌어요.',
    negotiate:'쉬는 것도 계획의 일부죠. 대신 시간은 지켜요.' };

  const fill = (tpl, ctx) => (tpl || '').replaceAll('{goal}', ctx.goal || '오늘의 목표');
  function say(kind, ctx, i = 0){
    const t = TEMPLATES[ctx.persona] || GENERIC;
    const v = t[kind];
    return fill(Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v, ctx);
  }
  /** 메인 잔소리: 백엔드 생성 텍스트 우선, 없으면 로컬 폴백 */
  const nag = (ctx) => ctx.nag || say('nudge', ctx);
  const persona = (ctx) => ({
    name: ctx.persona || '코치',
    ...(PERSONA_META[ctx.persona] || { icon:'💬', color:'#4F46E5' }),
  });

  /* ─────────────── 공용 API (개입들이 쓰는 도구상자) ─────────────── */
  const registry = new Map();
  let active = null;
  let currentCtx = null;

  const api = {
    root,
    /** 페이지 변형 대상 — host는 documentElement 자식이라 body 변형에 영향받지 않음 */
    page : () => document.body,
    say, persona,
    emit(id, action, payload = {}){
      try { chrome.runtime.sendMessage({ type:'BRAINSLAP_EVENT', id, action, payload }); } catch(e){}
    },
    addPoints(n){
      chrome.storage.local.get(['points'], (s) => {
        const total = Math.max(0, (s.points || 0) + n);
        chrome.storage.local.set({ points: total });
        api.emit('points', 'change', { delta:n, total });
      });
    },
    getPoints(cb){ chrome.storage.local.get(['points'], s => cb(s.points || 0)); },
    closeTab(){ try { chrome.runtime.sendMessage({ type:'BRAINSLAP_CLOSE_TAB' }); } catch(e){} },
    toast(msg, ms = 2600){
      root.querySelector('.iv-toast')?.remove();
      const t = document.createElement('div');
      t.className = 'iv-toast'; t.textContent = msg;
      root.appendChild(t);
      setTimeout(() => t.remove(), ms);
    },
    dismiss(){
      if (active){ active.cleanup?.(); active = null; }
      root.innerHTML = '';
      document.body.style.filter = '';
      document.body.style.transform = '';
    },
    chain(id){ trigger(id, currentCtx); },
  };

  function register(iv){ registry.set(iv.id, iv); }
  function trigger(id, ctx){
    api.dismiss();
    const iv = registry.get(id);
    if (!iv) return;
    currentCtx = ctx || currentCtx || {};
    active = iv;
    api.emit(id, 'triggered', { url: location.href });
    iv.trigger(currentCtx, api);
  }

  /* ════════════════════════════════════════════════════════════
   * [기능 01] 도망가는 종료 버튼 — 커서를 피해 화면 전역 도주
   * 복귀: +15pt & 탭 종료 / 7회 추적 시 버튼 항복(감금 금지 원칙)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'runaway-exit',
    trigger(ctx, api){
      let attempts = 0;
      const GIVE_UP_AT = 7;
      const TAUNTS = ['메롱~', '여기다!', '못 잡죠?', '운동 되죠?', '아직도?', '끈기 인정…'];
      const dim = document.createElement('div');
      dim.className = 'iv-dim';
      dim.innerHTML = `
        <div class="iv-card" style="position:relative">
          <div style="font-size:28px">${persona(ctx).icon}</div>
          <h3 style="margin-top:8px">여기서 멈추시겠어요?</h3>
          <p class="sub" id="rw-msg">${nag(ctx)}</p>
          <p class="sub" style="font-size:11.5px; color:#999">AI 분석: ${ctx.reason || '목표와의 연관성이 낮습니다.'} (${ctx.score ?? '?'}점/10점)</p>
          <button class="iv-primary" id="rw-back">✊ 창 닫고 일하러 가기 (+15pt)</button>
          <button class="iv-ghost" id="rw-exit" style="position:relative; z-index:5; transition:transform .22s cubic-bezier(.2,1.4,.3,1), left .22s cubic-bezier(.2,1.4,.3,1), top .22s cubic-bezier(.2,1.4,.3,1)">그래도 볼래요…</button>
          <p style="font-size:11px; color:#999; margin-top:10px; text-align:center" id="rw-count"></p>
        </div>`;
      api.root.appendChild(dim);
      const exitBtn = dim.querySelector('#rw-exit');
      const flee = () => {
        if (attempts >= GIVE_UP_AT) return;
        attempts++;
        api.emit(this.id, 'exit_attempt', { attempts });
        dim.querySelector('#rw-msg').textContent = say('runaway', ctx, attempts <= 2 ? 0 : attempts <= 4 ? 1 : 2);
        dim.querySelector('#rw-count').textContent = `탈출 시도 ${attempts}회째… ${TAUNTS[Math.min(attempts-1, TAUNTS.length-1)]}`;
        if (attempts >= GIVE_UP_AT){
          Object.assign(exitBtn.style, { position:'relative', left:'0px', top:'0px', transform:'scale(.7)', opacity:'.55' });
          exitBtn.textContent = '…알았어요, 눌러요 (버튼이 체념함)';
          return;
        }
        // 다이얼로그 탈출 → 뷰포트 전역 순간이동 (유쾌 도주)
        if (exitBtn.parentElement !== dim){ /* 이미 탈출 */ } else { dim.appendChild(exitBtn); exitBtn.style.position = 'fixed'; }
        exitBtn.style.width = 'auto'; exitBtn.style.padding = '11px 18px';
        exitBtn.style.left = Math.random() * (innerWidth  - 180) + 10 + 'px';
        exitBtn.style.top  = Math.random() * (innerHeight - 70)  + 10 + 'px';
        exitBtn.style.transform = `rotate(${(Math.random()-.5)*40}deg) scale(${.9+Math.random()*.35}) skewX(${(Math.random()-.5)*16}deg)`;
      };
      exitBtn.addEventListener('mouseenter', flee);
      exitBtn.addEventListener('touchstart', e => { if (attempts < GIVE_UP_AT){ e.preventDefault(); flee(); } }, { passive:false });
      exitBtn.onclick = () => {
        if (attempts < GIVE_UP_AT){ flee(); return; }
        api.emit(this.id, 'exit_confirmed', { attempts });
        api.dismiss();
        api.toast('…그래요. 대신 이 시간도 영수증에 적힙니다. 🧾');
      };
      dim.querySelector('#rw-back').onclick = () => {
        api.emit(this.id, 'gave_up_watching', { attempts });
        api.addPoints(15);
        api.chain('comeback-cheer');
        setTimeout(() => api.closeTab(), 2300); // 세리머니 감상 후 탭 종료
      };
    },
    cleanup(){},
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 02] DM식 집중 유도 — 푸시 알림 → 채팅창 → 읽씹 시 화면 점령
   * 첫 말풍선에 판정 파이프라인의 reason 을 잔소리 소재로 활용
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'dm-nudge', _timers:[],
    trigger(ctx, api){
      const p = persona(ctx);
      let chatOpened = false, replied = false, renotified = false;
      const showNoti = (preview) => {
        api.root.querySelector('.noti')?.remove();
        const n = document.createElement('div');
        n.className = 'noti';
        n.innerHTML = `
          <span class="n-icon" style="background:${p.color}">${p.icon}</span>
          <span class="n-body">
            <span class="n-app"><span>🖐️ BrainSlap · 메시지</span><span>지금</span></span>
            <span class="n-title">${p.name}</span>
            <span class="n-preview">${preview}</span>
          </span>`;
        api.root.appendChild(n);
        api.emit(this.id, 'noti_shown', { renotify: renotified });
        n.onclick = () => { api.emit(this.id, 'noti_opened', {}); n.remove(); openChat(false); };
      };
      showNoti(nag(ctx));
      this._timers.push(setTimeout(() => {
        if (chatOpened || !api.root.querySelector('.noti')) return;
        renotified = true;
        showNoti('읽고 씹는 것도 실력이라면 인정… 아 물론 칭찬 아님.');
        this._timers.push(setTimeout(() => {
          if (chatOpened) return;
          api.root.querySelector('.noti')?.remove();
          openChat(true, 'noti_ignored');
        }, 8000));
      }, 8000));

      const openChat = (takeover, stage) => {
        chatOpened = true;
        api.root.querySelector('.dm-window')?.remove();
        if (takeover){
          api.emit(this.id, 'ghosted_takeover', { stage });
          const bg = document.createElement('div'); bg.className = 'iv-dim';
          api.root.appendChild(bg);
        }
        const wrap = document.createElement('div');
        wrap.className = 'dm-window' + (takeover ? ' takeover' : '');
        wrap.innerHTML = `
          <div>
            <div class="dm-head">
              <span style="width:30px;height:30px;border-radius:50%;background:${p.color};display:grid;place-items:center;font-size:16px">${p.icon}</span>
              <b style="font-size:13.5px;color:#171717">${p.name}</b>
              <span style="font-size:10.5px;color:${takeover ? '#e5484d' : '#17a374'};margin-left:auto">● ${takeover ? '단단히 화가 남' : '온라인 (당신을 지켜보는 중)'}</span>
            </div>
            <div class="dm-body"></div>
            <div class="dm-replies"></div>
          </div>`;
        api.root.appendChild(wrap);
        const body = wrap.querySelector('.dm-body');
        const replies = wrap.querySelector('.dm-replies');
        const bubble = (text, delay) => new Promise(res => {
          this._timers.push(setTimeout(() => {
            const b = document.createElement('div');
            b.className = 'dm-bubble'; b.textContent = '● ● ●'; b.style.color = '#999';
            body.appendChild(b); body.scrollTop = body.scrollHeight;
            this._timers.push(setTimeout(() => { b.textContent = text; b.style.color = '#171717'; body.scrollTop = body.scrollHeight; res(b); }, 650));
          }, delay));
        });
        const showReplies = () => {
          replies.style.display = 'flex';
          replies.innerHTML = `
            <button class="iv-ghost" style="margin:0; flex:1" data-a="5min">5분만…</button>
            <button class="iv-primary" style="margin:0; flex:1.4; font-size:13px" data-a="return">지금 돌아갈게요 (+10pt)</button>`;
          replies.querySelector('[data-a="return"]').onclick = () => {
            replied = true;
            api.emit(this.id, 'reply_return', { fromTakeover: !!takeover });
            api.addPoints(10);
            api.dismiss();
            api.toast(say('praise', ctx));
            setTimeout(() => api.closeTab(), 1600);
          };
          replies.querySelector('[data-a="5min"]').onclick = async () => {
            replied = true;
            api.emit(this.id, 'reply_5min', { fromTakeover: !!takeover });
            replies.style.display = 'none';
            await bubble('5분이 유튜브 시간으로는 45분인 거 알지? 정식으로 협상하자.', 200);
            this._timers.push(setTimeout(() => api.chain('negotiation'), 1100));
          };
        };
        (async () => {
          if (takeover){
            await bubble(say('ghosted', ctx), 350);
            await bubble('이래도 안 볼 수 있을까? 이제 이 화면은 내 거야.', 550);
            // 읽씹 페널티: 백엔드에 강도 +1 잔소리 재생성 요청 (히스토리 반복 방지 활용)
            const fresh = await requestFreshNag(ctx);
            await bubble(fresh || `"${ctx.goal}" — 답장 전까지 딴짓은 여기서 끝.`, 550);
          } else {
            await bubble(nag(ctx), 300);
            await bubble(`AI 분석: "${ctx.reason || '이 페이지, 목표랑 상관없대.'}" (${ctx.score ?? '?'}점)`, 500);
          }
          showReplies();
          if (!takeover){
            this._timers.push(setTimeout(() => {
              if (!replied && api.root.contains(wrap)) openChat(true, 'chat_ignored');
            }, 15000));
          }
        })();
      };
    },
    cleanup(){ this._timers.forEach(clearTimeout); this._timers = []; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 03] 도파민 페이드 — 페이지가 8초에 걸쳐 흑백+블러
   * document.body 에 CSS filter 만 적용 (이벤트 무개입)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'focus-fade', _raf:null,
    trigger(ctx, api){
      const DURATION = 8000, start = performance.now();
      let done = false;
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `<span>🎨 목표와 멀어질수록 색을 잃는 중…</span><button>목표로 복귀 (+8pt)</button>`;
      api.root.appendChild(pill);
      const step = (now) => {
        const t = Math.min(1, (now - start) / DURATION);
        api.page().style.filter = `grayscale(${t}) blur(${t*2.5}px) brightness(${1-t*.25})`;
        if (t < 1) this._raf = requestAnimationFrame(step);
        else if (!done){ done = true; api.emit(this.id, 'fade_complete', {}); pill.querySelector('span').textContent = '⬛ 도파민이 모두 증발했습니다.'; }
      };
      this._raf = requestAnimationFrame(step);
      pill.querySelector('button').onclick = () => {
        cancelAnimationFrame(this._raf);
        api.emit(this.id, 'returned', {});
        api.addPoints(8);
        api.dismiss();
        api.toast('색이 돌아왔습니다. 당신의 하루도요. (+8pt)');
        setTimeout(() => api.closeTab(), 1600);
      };
    },
    cleanup(){ cancelAnimationFrame(this._raf); document.body.style.filter = ''; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 04] 알림 폭탄 — 확인을 누르면 2개가 태어나는 팝업 지옥
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'alert-storm',
    trigger(ctx, api){
      const MAX = 6; let spawned = 0;
      const LINES = ['경고: 딴짓이 감지되었습니다.', '확인을 눌러도 소용없습니다.',
        '이 창은 당신이 목표로 돌아갈 때까지 증식합니다.', `"${ctx.goal}" — 기억나시죠?`,
        '슬슬 지치셨나요? 저희는 안 지칩니다.'];
      const spawnAlert = (final = false) => {
        spawned++;
        api.emit(this.id, 'alert_spawned', { n: spawned, final });
        const a = document.createElement('div');
        a.className = 'fake-alert';
        a.style.left = Math.random() * Math.max(20, innerWidth - 300) + 'px';
        a.style.top  = Math.random() * Math.max(20, innerHeight - 220) + 'px';
        const line = final ? `${persona(ctx).icon} ${nag(ctx)}` : LINES[Math.min(spawned-1, LINES.length-1)];
        a.innerHTML = `
          <div class="fa-bar"><i></i><i></i><i></i><b>BrainSlap ${final ? '최후통첩' : '시스템 알림 ('+spawned+')'}</b></div>
          <div class="fa-body">${line}</div>
          ${final
            ? `<button class="fa-btn" data-act="return">항복! 일하러 가기 (+12pt)</button>
               <button class="fa-btn" data-act="stay" style="background:#999; margin-top:-6px">그래도 본다 (영수증행)</button>`
            : `<button class="fa-btn" data-act="ok">확인</button>`}`;
        api.root.appendChild(a);
        a.querySelectorAll('.fa-btn').forEach(btn => btn.onclick = () => {
          const act = btn.dataset.act;
          if (act === 'ok'){
            a.remove();
            if (spawned < MAX){ spawnAlert(); spawnAlert(spawned + 1 >= MAX); }
            else spawnAlert(true);
          } else {
            api.emit(this.id, 'storm_resolved', { returned: act === 'return', totalAlerts: spawned });
            api.dismiss();
            if (act === 'return'){ api.addPoints(12); api.chain('comeback-cheer'); setTimeout(() => api.closeTab(), 2300); }
            else api.toast('알겠습니다… 이 결정도 오늘의 영수증에 기록됩니다 🧾');
          }
        });
      };
      spawnAlert();
    },
    cleanup(){},
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 05] 집중 협상 테이블 — 포인트로 공식 휴식권 구매
   * 복귀 보너스는 chrome.storage 플래그로 1회 제한 (파밍 방지)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'negotiation', _timer:null,
    trigger(ctx, api){
      chrome.storage.local.get(['points','negoBonusPaid'], (s) => {
        const pts = s.points || 0, bonusOK = !s.negoBonusPaid;
        const dim = document.createElement('div');
        dim.className = 'iv-dim';
        dim.innerHTML = `
          <div class="iv-card">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <h3>🤝 협상 테이블</h3>
              <span style="font-size:11.5px; font-weight:700; color:#5046e5; background:#eef0ff; padding:4px 11px; border-radius:99px">보유 ${pts}pt</span>
            </div>
            <p class="sub">${say('negotiate', ctx)}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:15px">
              <button class="iv-ghost" style="margin:0; padding:15px 8px; ${pts>=30 ? '' : 'opacity:.4; pointer-events:none'}" data-buy="5">
                <b style="font-size:15px; color:#171717">☕ 5분 휴식</b><br><span style="font-size:11px">-30pt · 타이머</span></button>
              <button class="iv-ghost" style="margin:0; padding:15px 8px; ${pts>=55 ? '' : 'opacity:.4; pointer-events:none'}" data-buy="10">
                <b style="font-size:15px; color:#171717">🍜 10분 휴식</b><br><span style="font-size:11px">-55pt · 타이머</span></button>
            </div>
            <button class="iv-primary" id="ng-return">${bonusOK ? '협상 결렬! 그냥 일하러 간다 (+15pt 보너스)' : '그냥 일하러 간다 (복귀 보너스는 1회만!)'}</button>
            <p style="font-size:11px; color:#999; text-align:center; margin-top:10px">휴식권은 딴짓이 아니라 <b>공식 휴식</b>입니다. 죄책감 0%.</p>
          </div>`;
        api.root.appendChild(dim);
        const buy = (min, cost) => {
          api.addPoints(-cost);
          api.emit(this.id, 'break_purchased', { minutes:min, cost });
          api.dismiss();
          const chip = document.createElement('div');
          chip.className = 'pill'; chip.style.background = '#17a374';
          api.root.appendChild(chip);
          let left = min * 60;
          const tick = () => {
            chip.textContent = `☕ 공식 휴식 중 — ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} 남음`;
            if (left-- <= 0){ chip.remove(); api.emit(this.id, 'break_ended', { minutes:min }); api.chain('dm-nudge'); return; }
            this._timer = setTimeout(tick, 1000); // 실서비스: 실시간
          };
          tick();
        };
        dim.querySelector('[data-buy="5"]').onclick  = () => buy(5, 30);
        dim.querySelector('[data-buy="10"]').onclick = () => buy(10, 55);
        dim.querySelector('#ng-return').onclick = () => {
          if (bonusOK){ api.addPoints(15); chrome.storage.local.set({ negoBonusPaid:true }); }
          api.emit(this.id, 'return_bonus', { bonus: bonusOK ? 15 : 0 });
          api.chain('comeback-cheer');
          setTimeout(() => api.closeTab(), 2300);
        };
      });
    },
    cleanup(){ clearTimeout(this._timer); },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 06] 도파민 영수증 — 오늘의 차단 기록을 영수증으로 발행
   * 데이터: background 가 차단 시마다 storage.distractLog 에 적재
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'dopamine-receipt', _timers:[],
    trigger(ctx, api){
      chrome.storage.local.get(['distractLog'], (s) => {
        const items = (s.distractLog || []).slice(-6);
        if (!items.length) items.push({ site:location.hostname, title:document.title.slice(0,22), time:'방금' });
        const dim = document.createElement('div');
        dim.className = 'iv-dim';
        const rows = items.map(it =>
          `<div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px; animation:bsPopIn .2s ease">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${it.site} · ${it.title}</span>
            <b style="flex:none">${it.time}</b></div>`).join('');
        dim.innerHTML = `
          <div style="width:min(94vw,390px); background:#fdfdf6; border-radius:8px; padding:26px 22px;
            font-family:ui-monospace,Consolas,monospace; font-size:13px; color:#222;
            box-shadow:0 24px 60px rgba(0,0,0,.45); animation:bsPopIn .35s ease">
            <div style="text-align:center; border-bottom:1.5px dashed #bbb; padding-bottom:12px">
              <b style="font-size:17px; letter-spacing:.18em">도파민 상점</b><br>
              <span style="color:#777; font-size:11px">DOPAMINE MART — 고객명: 미래의 나</span></div>
            <div style="padding:11px 0; border-bottom:1.5px dashed #bbb">${rows}</div>
            <div style="padding:11px 0; font-weight:700; font-size:14px">
              <div style="display:flex; justify-content:space-between"><span>오늘 적발 횟수</span><span>${items.length}회</span></div>
              <div style="display:flex; justify-content:space-between; color:#777; font-weight:400; margin-top:4px; font-size:12px"><span>지불 수단</span><span>당신의 미래</span></div>
              <div style="text-align:center; margin-top:10px; letter-spacing:3px; color:#333">▮▮▯▮▮▮▯▮▮▯▮▮▮▯▮▮</div>
              <div style="text-align:center; color:#999; font-weight:400; margin-top:4px; font-size:11px">*환불 불가 — 시간은 반품되지 않습니다</div></div>
            <button class="iv-primary" style="font-family:'Pretendard',sans-serif" id="rc-close">반성 완료, 일하러 가기 (+5pt)</button>
          </div>`;
        api.root.appendChild(dim);
        api.emit(this.id, 'receipt_viewed', { items: items.length });
        dim.querySelector('#rc-close').onclick = () => {
          api.emit(this.id, 'receipt_closed', {});
          api.addPoints(5);
          api.dismiss();
          api.toast('내일 영수증은 0건이 목표입니다. (+5pt)');
          setTimeout(() => api.closeTab(), 1600);
        };
      });
    },
    cleanup(){ this._timers.forEach(clearTimeout); this._timers = []; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 07] 복귀 세리머니 — 딴짓 복귀 시에만 발동 (세션 완주 X)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'comeback-cheer', reward:true, _timers:[],
    trigger(ctx, api){
      const dim = document.createElement('div');
      dim.className = 'iv-dim';
      dim.style.background = 'rgba(8,8,12,.74)';
      dim.innerHTML = `
        <div style="text-align:center; color:#fff; animation:bsPopIn .35s cubic-bezier(.2,.9,.3,1.3)">
          <div style="font-size:48px">${persona(ctx).icon}</div>
          <div style="font-size:22px; font-weight:800; margin-top:8px">복귀 완료!</div>
          <div style="font-size:13.5px; opacity:.85; margin-top:7px; max-width:260px">${say('praise', ctx)}</div>
          <div style="font-size:34px; font-weight:900; margin-top:14px; color:#a5f3c9" id="cc-pts">+0pt</div>
        </div>
        <canvas style="position:fixed; inset:0; pointer-events:none"></canvas>`;
      api.root.appendChild(dim);
      let n = 0;
      const ptsEl = dim.querySelector('#cc-pts');
      const up = () => { ptsEl.textContent = `+${n}pt`; if (n++ < 15) this._timers.push(setTimeout(up, 45)); };
      up();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches){
        const cv = dim.querySelector('canvas');
        cv.width = innerWidth; cv.height = innerHeight;
        const g = cv.getContext('2d');
        const COLORS = ['#5046e5','#17a374','#f5a623','#e5484d','#38bdf8'];
        const parts = Array.from({ length: 90 }, () => ({
          x: innerWidth/2, y: innerHeight/2, r: 3 + Math.random()*5,
          vx:(Math.random()-.5)*13, vy:-5 - Math.random()*9,
          c: COLORS[(Math.random()*COLORS.length)|0], rot: Math.random()*6 }));
        const start = performance.now();
        const draw = (now) => {
          g.clearRect(0, 0, cv.width, cv.height);
          parts.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += .25; p.rot += .1;
            g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
            g.fillStyle = p.c; g.fillRect(-p.r, -p.r/2, p.r*2, p.r); g.restore();
          });
          if (now - start < 1800) requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
      }
      api.emit(this.id, 'celebrated', {});
      this._timers.push(setTimeout(() => api.dismiss(), 2200));
    },
    cleanup(){ this._timers.forEach(clearTimeout); this._timers = []; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 08] 잭팟 룰렛 — 세션 무결점 완주(30분↑) 시 12% 확률 발동
   * background 의 BRAINSLAP_SESSION_RESULT 메시지로만 트리거됨
   * (당첨 추첨은 추후 서버 사이드 이전 예정 — 어뷰징 방지)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'jackpot-roulette', reward:true, _timers:[],
    trigger(ctx, api){
      const SEGS = [[50,'#5046e5',30],[120,'#17a374',22],[80,'#f5a623',24],[200,'#e5484d',14],[100,'#38bdf8',20],[500,'#111111',4]];
      const n = SEGS.length, arc = 360/n;
      const totalW = SEGS.reduce((s,x)=>s+x[2],0);
      let r = Math.random()*totalW, win = 0;
      for (let i=0;i<n;i++){ r -= SEGS[i][2]; if (r<=0){ win=i; break; } }
      const conic = SEGS.map((s,i)=>`${s[1]} ${i*arc}deg ${(i+1)*arc}deg`).join(', ');
      const dim = document.createElement('div');
      dim.className = 'iv-dim';
      dim.innerHTML = `
        <div class="iv-card" style="text-align:center">
          <h3>🎰 무결점 완주! 잭팟 룰렛</h3>
          <p class="sub">${ctx.minutes || 30}분 무결점 완주 + 12% 행운까지. 오늘의 주인공은 당신!</p>
          <div style="position:relative; width:220px; height:220px; margin:16px auto 8px">
            <div style="position:absolute; top:-9px; left:50%; transform:translateX(-50%); z-index:2; width:0; height:0;
              border-left:11px solid transparent; border-right:11px solid transparent; border-top:17px solid #171717"></div>
            <div class="wheel" style="background:conic-gradient(from 0deg, ${conic})"></div>
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:46px; height:46px;
              border-radius:50%; background:#fff; display:grid; place-items:center; font-size:21px; z-index:2;
              box-shadow:0 2px 8px rgba(0,0,0,.2)">🖐️</div>
          </div>
          <div style="display:flex; justify-content:center; gap:7px; flex-wrap:wrap; font-size:11px; color:#999">
            ${SEGS.map(s=>`<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s[1]};margin-right:3px"></i>${s[0]}pt</span>`).join('')}
          </div>
          <button class="iv-primary" id="jr-spin">돌리기!</button>
          <div id="jr-result" style="display:none; margin-top:13px; font-size:24px; font-weight:900; color:#5046e5; animation:bsPopIn .3s cubic-bezier(.2,.9,.3,1.4)"></div>
        </div>`;
      api.root.appendChild(dim);
      const wheel = dim.querySelector('.wheel'), spinBtn = dim.querySelector('#jr-spin');
      spinBtn.onclick = () => {
        spinBtn.disabled = true; spinBtn.style.opacity = '.45'; spinBtn.textContent = '두구두구두구…';
        api.emit(this.id, 'spin_start', { willWin: SEGS[win][0] });
        const target = 1800 + (360 - (win*arc + arc/2)) + (Math.random()*14 - 7);
        wheel.style.transform = `rotate(${target}deg)`;
        this._timers.push(setTimeout(() => {
          const prize = SEGS[win][0];
          api.addPoints(prize);
          api.emit(this.id, 'jackpot_won', { prize });
          dim.querySelector('#jr-result').style.display = 'block';
          dim.querySelector('#jr-result').textContent = `🎉 +${prize}pt 획득!`;
          // 세션 '완주'는 복귀가 아니므로 세리머니 미발동
          spinBtn.textContent = '수고했어요, 오늘의 집중 끝!';
          spinBtn.disabled = false; spinBtn.style.opacity = '1';
          spinBtn.onclick = () => { api.dismiss(); api.toast('세션 종료. 잭팟까지 챙긴 완벽한 하루 🎉'); };
        }, 3800));
      };
    },
    cleanup(){ this._timers.forEach(clearTimeout); this._timers = []; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 09] 재미 버퍼링 — 재미가 로딩되지 않습니다 (FOCUS_REQUIRED)
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'fun-buffering', _timers:[],
    trigger(ctx, api){
      let retries = 0;
      const ERRORS = ['도파민 서버 연결 실패 (오류코드: FOCUS_REQUIRED)',
        '재시도 실패. 서버가 당신의 목표 완료 여부를 확인 중입니다.',
        '여전히 실패. 참고로 서버는 멀쩡합니다. 문제는… 아시죠?',
        `최종 실패. "${ctx.goal}" 완료 시 재미가 자동 복구됩니다.`];
      const dim = document.createElement('div');
      dim.className = 'iv-dim';
      dim.innerHTML = `
        <div style="text-align:center; color:#fff; width:min(88vw,360px)">
          <div class="buf-ring"></div>
          <div style="font-size:15.5px; font-weight:800" id="bf-title">재미를 불러오는 중…</div>
          <div style="font-size:12.5px; opacity:.75; margin-top:7px; min-height:36px" id="bf-msg">잠시만 기다려 주세요</div>
          <div id="bf-actions" style="display:none">
            <button class="iv-primary" id="bf-return" style="background:#fff; color:#111">목표로 복귀하면 즉시 해결 (+8pt)</button>
            <button class="iv-ghost" id="bf-retry" style="color:#fff; border-color:rgba(255,255,255,.3); background:transparent">다시 시도</button>
          </div>
        </div>`;
      api.root.appendChild(dim);
      const ring = dim.querySelector('.buf-ring'), title = dim.querySelector('#bf-title'),
            msg = dim.querySelector('#bf-msg'), actions = dim.querySelector('#bf-actions');
      const fail = () => {
        ring.style.animationPlayState = 'paused'; ring.style.borderTopColor = '#e5484d';
        title.textContent = '재미 로딩 실패';
        msg.textContent = ERRORS[Math.min(retries, ERRORS.length-1)];
        actions.style.display = 'block';
      };
      this._timers.push(setTimeout(fail, 2000));
      dim.querySelector('#bf-retry').onclick = () => {
        retries++;
        api.emit(this.id, 'retry_futile', { retries });
        ring.style.animationPlayState = 'running'; ring.style.borderTopColor = '#fff';
        title.textContent = '재시도 중…'; actions.style.display = 'none';
        this._timers.push(setTimeout(fail, 1300));
      };
      dim.querySelector('#bf-return').onclick = () => {
        api.emit(this.id, 'returned', { retries });
        api.addPoints(8);
        api.dismiss();
        api.toast('재미 서버가 복구되었습니다. 목표 완료 후 재접속하세요 ✅');
        setTimeout(() => api.closeTab(), 1600);
      };
    },
    cleanup(){ this._timers.forEach(clearTimeout); this._timers = []; },
  });

  /* ════════════════════════════════════════════════════════════
   * [기능 10] 기울어진 세계 — 목표에서 벗어난 각도만큼 화면이 기움
   * ════════════════════════════════════════════════════════════ */
  register({
    id:'tilt-world', _raf:null,
    trigger(ctx, api){
      const DURATION = 6000, MAX_DEG = 8, start = performance.now();
      let done = false;
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `<span id="tw-label">🌀 기울기 0.0° — 목표 이탈 감지</span><button>수평 되찾기 (+8pt)</button>`;
      api.root.appendChild(pill);
      const step = (now) => {
        const t = Math.min(1, (now - start) / DURATION);
        const deg = t * MAX_DEG;
        api.page().style.transform = `rotate(${deg}deg) scale(${1 - t*.06})`;
        pill.querySelector('#tw-label').textContent = `🌀 기울기 ${deg.toFixed(1)}° — 목표 이탈 감지`;
        if (t < 1) this._raf = requestAnimationFrame(step);
        else if (!done){ done = true; api.emit(this.id, 'fully_tilted', {}); pill.querySelector('#tw-label').textContent = '🌀 이 각도로 계속 보실 건가요…?'; }
      };
      this._raf = requestAnimationFrame(step);
      pill.querySelector('button').onclick = () => {
        cancelAnimationFrame(this._raf);
        api.page().style.transition = 'transform .5s'; api.page().style.transform = 'none';
        api.emit(this.id, 'returned', {});
        api.addPoints(8);
        api.dismiss();
        api.toast('세계가 수평을 되찾았습니다. 당신 덕분에요. (+8pt)');
        setTimeout(() => api.closeTab(), 1600);
      };
    },
    cleanup(){ cancelAnimationFrame(this._raf); document.body.style.transform = ''; },
  });

  /* 백엔드 /nagging 재호출 (background 경유 — CSP/CORS 회피).
   * 페르소나 파트의 히스토리 저장소가 반복을 막아주므로 매번 새 문장이 온다. */
  function requestFreshNag(ctx){
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          type: 'BRAINSLAP_REQUEST_NAG',
          title: ctx.title || document.title,
          reason: ctx.reason || '',
          intensityBoost: 1, // 읽씹 페널티: 말투 강도 +1
        }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) return resolve(null);
          resolve(res.nagging?.text || null);
        });
      } catch(e){ resolve(null); }
    });
  }

  /* ─────────────── background 메시지 수신부 ─────────────── */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'BRAINSLAP_BLOCK'){
      trigger(msg.interventionId || 'runaway-exit', {
        goal: msg.goal, reason: msg.reason, score: msg.score,
        persona: msg.persona || '교관',
        intensity: msg.intensity || 3,
        nag: msg.nag || null,        // 백엔드(/analyze·/nagging) 생성 잔소리
        toneTag: msg.toneTag || 'neutral',
        title: msg.title || document.title,
      });
    }
    if (msg?.type === 'BRAINSLAP_SESSION_RESULT'){
      const ctx = { goal: msg.goal, persona: msg.persona || '교관', minutes: msg.minutes };
      currentCtx = ctx;
      if (msg.jackpot){ trigger('jackpot-roulette', ctx); }
      else if (msg.perfect){ api.toast(`무결점 완주! 시간 보상 +${msg.baseReward}pt · 오늘은 잭팟이 비껴갔네요 (12%) 🎲`, 3600); }
      else { api.toast(`세션 완료. 딴짓 기록이 있어 잭팟은 무효 (+${msg.baseReward}pt)`, 3200); }
    }
  });

  console.log('[BrainSlap] 개입 모듈 v1.0 로드 완료 — 10종 대기 중');
})();
