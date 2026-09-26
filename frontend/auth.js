// AeroCast Auth & Search History - Vanilla JS
// Handles: Supabase email-magic-link + phone-OTP sign-in, session state,
// the header auth controls, and the per-user search history drawer.
// Fully decoupled from app.js via two CustomEvents:
//   window dispatches "aerocast:query-answered" {question, lang, location, topic} after each answer
//   this module dispatches "aerocast:reask" {text} when the user taps a history item
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };

  // --- i18n (small subset covering just the auth / history chrome) ---
  const T = {
    en: { signIn: "Sign in", signOut: "Sign out", guest: "Guest", history: "History",
      modalTitle: "Sign in to AeroCast", tabEmail: "Email", tabPhone: "Phone",
      emailLabel: "Email address", emailPlaceholder: "you@example.com", sendLink: "Send magic link",
      phoneLabel: "Phone number", codeLabel: "6-digit code", sendCode: "Send code", verifyCode: "Verify & sign in",
      resend: "Resend code", changeNumber: "Change number",
      guestContinue: "Continue as guest", guestNote: "No account needed \u2014 full weather, farm & marine access without signing in.",
      linkSent: "Magic link sent! Check your inbox and tap the link to sign in.",
      codeSent: "Code sent by SMS. Enter it below.",
      notConfigured: "Sign-in isn\u2019t configured for this deployment yet (missing Supabase keys) \u2014 continue as a guest.",
      genericError: "Something went wrong. Please try again.",
      invalidEmail: "Enter a valid email address.", invalidPhone: "Enter a valid phone number with country code.",
      invalidCode: "Enter the 6-digit code.",
      historyTitle: "Your search history", today: "Today", yesterday: "Yesterday", earlier: "Earlier",
      empty: "No searches yet. Ask AeroCast a question and it will show up here.",
      clearAll: "Clear all", confirmClear: "Delete your entire search history?", close: "Close",
      signedInAs: "Signed in" },
    hi: { signIn: "साइन इन", signOut: "साइन आउट", guest: "गेस्ट", history: "इतिहास",
      modalTitle: "AeroCast में साइन इन करें", tabEmail: "ईमेल", tabPhone: "फ़ोन",
      emailLabel: "ईमेल पता", emailPlaceholder: "you@example.com", sendLink: "मैजिक लिंक भेजें",
      phoneLabel: "फ़ोन नंबर", codeLabel: "6-अंकों का कोड", sendCode: "कोड भेजें", verifyCode: "सत्यापित करें और साइन इन करें",
      resend: "कोड फिर भेजें", changeNumber: "नंबर बदलें",
      guestContinue: "गेस्ट के रूप में जारी रखें", guestNote: "खाते की ज़रूरत नहीं \u2014 बिना साइन इन किए पूरी मौसम, कृषि व समुद्री सुविधा पाएं।",
      linkSent: "मैजिक लिंक भेज दिया गया! अपना इनबॉक्स देखें और लिंक पर टैप करें।",
      codeSent: "SMS से कोड भेजा गया। नीचे दर्ज करें।",
      notConfigured: "इस डिप्लॉयमेंट के लिए साइन-इन अभी सेट नहीं है \u2014 गेस्ट के रूप में जारी रखें।",
      genericError: "कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
      invalidEmail: "मान्य ईमेल पता दर्ज करें।", invalidPhone: "देश कोड सहित मान्य फ़ोन नंबर दर्ज करें।",
      invalidCode: "6-अंकों का कोड दर्ज करें।",
      historyTitle: "आपका खोज इतिहास", today: "आज", yesterday: "कल", earlier: "पहले",
      empty: "अभी तक कोई खोज नहीं। AeroCast से सवाल पूछें, वह यहाँ दिखेगा।",
      clearAll: "सभी हटाएं", confirmClear: "अपना पूरा खोज इतिहास हटाएं?", close: "बंद करें",
      signedInAs: "साइन इन किया गया" },
    bn: { signIn: "সাইন ইন", signOut: "সাইন আউট", guest: "গেস্ট", history: "ইতিহাস",
      modalTitle: "AeroCast-এ সাইন ইন করুন", tabEmail: "ইমেল", tabPhone: "ফোন",
      emailLabel: "ইমেল ঠিকানা", emailPlaceholder: "you@example.com", sendLink: "ম্যাজিক লিঙ্ক পাঠান",
      phoneLabel: "ফোন নম্বর", codeLabel: "৬-সংখ্যার কোড", sendCode: "কোড পাঠান", verifyCode: "যাচাই করুন ও সাইন ইন করুন",
      resend: "আবার কোড পাঠান", changeNumber: "নম্বর পরিবর্তন করুন",
      guestContinue: "গেস্ট হিসেবে চালিয়ে যান", guestNote: "অ্যাকাউন্টের দরকার নেই \u2014 সাইন ইন ছাড়াই সম্পূর্ণ আবহাওয়া, কৃষি ও সামুদ্রিক সুবিধা।",
      linkSent: "ম্যাজিক লিঙ্ক পাঠানো হয়েছে! ইনবক্স দেখুন এবং লিঙ্কে ট্যাপ করুন।",
      codeSent: "SMS-এ কোড পাঠানো হয়েছে। নিচে লিখুন।",
      notConfigured: "এই ডেপ্লয়মেন্টে সাইন-ইন এখনও সেট করা নেই \u2014 গেস্ট হিসেবে চালিয়ে যান।",
      genericError: "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
      invalidEmail: "একটি সঠিক ইমেল ঠিকানা লিখুন।", invalidPhone: "দেশের কোডসহ সঠিক ফোন নম্বর লিখুন।",
      invalidCode: "৬-সংখ্যার কোড লিখুন।",
      historyTitle: "আপনার অনুসন্ধান ইতিহাস", today: "আজ", yesterday: "গতকাল", earlier: "আগে",
      empty: "এখনো কোনো অনুসন্ধান নেই। AeroCast-কে প্রশ্ন করুন, এখানে দেখা যাবে।",
      clearAll: "সব মুছুন", confirmClear: "আপনার সম্পূর্ণ অনুসন্ধান ইতিহাস মুছবেন?", close: "বন্ধ করুন",
      signedInAs: "সাইন ইন করা হয়েছে" },
    ta: { signIn: "உள்நுழை", signOut: "வெளியேறு", guest: "விருந்தினர்", history: "வரலாறு",
      modalTitle: "AeroCast-இல் உள்நுழையவும்", tabEmail: "மின்னஞ்சல்", tabPhone: "தொலைபேசி",
      emailLabel: "மின்னஞ்சல் முகவரி", emailPlaceholder: "you@example.com", sendLink: "மேஜிக் லிங்க் அனுப்பவும்",
      phoneLabel: "தொலைபேசி எண்", codeLabel: "6-இலக்க குறியீடு", sendCode: "குறியீடு அனுப்பவும்", verifyCode: "சரிபார்த்து உள்நுழையவும்",
      resend: "மீண்டும் அனுப்பவும்", changeNumber: "எண்ணை மாற்றவும்",
      guestContinue: "விருந்தினராக தொடரவும்", guestNote: "கணக்கு தேவையில்லை \u2014 உள்நுழையாமல் முழு வானிலை, விவசாய, கடல் அணுகல்.",
      linkSent: "மேஜிக் லிங்க் அனுப்பப்பட்டது! இன்பாக்ஸைச் சரிபார்த்து லிங்கை தட்டவும்.",
      codeSent: "SMS மூலம் குறியீடு அனுப்பப்பட்டது. கீழே உள்ளிடவும்.",
      notConfigured: "இந்த வெளியீட்டிற்கு உள்நுழைவு இன்னும் அமைக்கப்படவில்லை \u2014 விருந்தினராக தொடரவும்.",
      genericError: "ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.",
      invalidEmail: "சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.", invalidPhone: "நாட்டுக் குறியீடுடன் சரியான எண்ணை உள்ளிடவும்.",
      invalidCode: "6-இலக்க குறியீட்டை உள்ளிடவும்.",
      historyTitle: "உங்கள் தேடல் வரலாறு", today: "இன்று", yesterday: "நேற்று", earlier: "முன்பு",
      empty: "இதுவரை தேடல் இல்லை. AeroCast-இடம் ஒரு கேள்வி கேளுங்கள், இங்கே தெரியும்.",
      clearAll: "அனைத்தையும் அழி", confirmClear: "உங்கள் முழு தேடல் வரலாற்றையும் நீக்கவா?", close: "மூடு",
      signedInAs: "உள்நுழைந்துள்ளீர்கள்" },
    te: { signIn: "సైన్ ఇన్", signOut: "సైన్ అవుట్", guest: "గెస్ట్", history: "చరిత్ర",
      modalTitle: "AeroCastలో సైన్ ఇన్ చేయండి", tabEmail: "ఇమెయిల్", tabPhone: "ఫోన్",
      emailLabel: "ఇమెయిల్ చిరునామా", emailPlaceholder: "you@example.com", sendLink: "మేజిక్ లింక్ పంపండి",
      phoneLabel: "ఫోన్ నంబర్", codeLabel: "6-అంకెల కోడ్", sendCode: "కోడ్ పంపండి", verifyCode: "ధృవీకరించి సైన్ ఇన్ చేయండి",
      resend: "మళ్లీ పంపండి", changeNumber: "నంబర్ మార్చండి",
      guestContinue: "గెస్ట్‌గా కొనసాగండి", guestNote: "ఖాతా అవసరం లేదు \u2014 సైన్ ఇన్ లేకుండా పూర్తి వాతావరణ, వ్యవసాయ, సముద్ర సదుపాయం.",
      linkSent: "మేజిక్ లింక్ పంపబడింది! ఇన్‌బాక్స్ చూసి లింక్‌ను నొక్కండి.",
      codeSent: "SMS ద్వారా కోడ్ పంపబడింది. కింద నమోదు చేయండి.",
      notConfigured: "ఈ డిప్లాయ్‌మెంట్ కోసం సైన్-ఇన్ ఇంకా సెట్ కాలేదు \u2014 గెస్ట్‌గా కొనసాగండి.",
      genericError: "ఏదో తప్పు జరిగింది. దయచేసి మళ్లీ ప్రయత్నించండి.",
      invalidEmail: "సరైన ఇమెయిల్ చిరునామా నమోదు చేయండి.", invalidPhone: "దేశ కోడ్‌తో సరైన ఫోన్ నంబర్ నమోదు చేయండి.",
      invalidCode: "6-అంకెల కోడ్ నమోదు చేయండి.",
      historyTitle: "మీ శోధన చరిత్ర", today: "ఈరోజు", yesterday: "నిన్న", earlier: "ముందు",
      empty: "ఇంకా శోధనలు లేవు. AeroCastని ఒక ప్రశ్న అడగండి, ఇక్కడ కనిపిస్తుంది.",
      clearAll: "అన్నీ తొలగించు", confirmClear: "మీ మొత్తం శోధన చరిత్రను తొలగించాలా?", close: "మూసివేయి",
      signedInAs: "సైన్ ఇన్ చేయబడింది" },
    mr: { signIn: "साइन इन", signOut: "साइन आउट", guest: "गेस्ट", history: "इतिहास",
      modalTitle: "AeroCast मध्ये साइन इन करा", tabEmail: "ईमेल", tabPhone: "फोन",
      emailLabel: "ईमेल पत्ता", emailPlaceholder: "you@example.com", sendLink: "मॅजिक लिंक पाठवा",
      phoneLabel: "फोन नंबर", codeLabel: "6-अंकी कोड", sendCode: "कोड पाठवा", verifyCode: "पडताळा आणि साइन इन करा",
      resend: "पुन्हा कोड पाठवा", changeNumber: "नंबर बदला",
      guestContinue: "गेस्ट म्हणून सुरू ठेवा", guestNote: "खात्याची गरज नाही \u2014 साइन इन न करता संपूर्ण हवामान, शेती व सागरी सुविधा.",
      linkSent: "मॅजिक लिंक पाठवली! इनबॉक्स तपासा आणि लिंकवर टॅप करा.",
      codeSent: "SMS द्वारे कोड पाठवला. खाली टाका.",
      notConfigured: "या डिप्लॉयमेंटसाठी साइन-इन अद्याप सेट केलेले नाही \u2014 गेस्ट म्हणून सुरू ठेवा.",
      genericError: "काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.",
      invalidEmail: "वैध ईमेल पत्ता टाका.", invalidPhone: "देश कोडसह वैध फोन नंबर टाका.",
      invalidCode: "6-अंकी कोड टाका.",
      historyTitle: "तुमचा शोध इतिहास", today: "आज", yesterday: "काल", earlier: "आधी",
      empty: "अजून शोध नाही. AeroCast ला प्रश्न विचारा, तो इथे दिसेल.",
      clearAll: "सर्व हटवा", confirmClear: "तुमचा संपूर्ण शोध इतिहास हटवायचा का?", close: "बंद करा",
      signedInAs: "साइन इन केले" }
  };
  const lang = () => (typeof localStorage !== 'undefined' && localStorage.getItem('weathergpt_lang')) || 'en';
  const t = () => T[lang()] || T.en;

  // --- Supabase client (guarded: works fully in Guest Mode if unset) ---
  const SUPABASE_URL = window.CONFIG?.SUPABASE_URL || '';
  const SUPABASE_KEY = window.CONFIG?.ANON_KEY || '';
  const configured = !!(SUPABASE_URL && SUPABASE_KEY && window.supabase);
  const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  let session = null;
  let pendingPhone = '';

  // --- DOM refs (built once index.html has loaded) ---
  function buildHeaderControls() {
    const actions = $('headerActions') || document.querySelector('.header-actions');
    if (!actions) return;

    const wrap = el('div', 'auth-controls');
    wrap.id = 'authControls';

    const signInBtn = el('button', 'ctrl-btn-arch', t().signIn);
    signInBtn.type = 'button';
    signInBtn.id = 'signInBtn';
    signInBtn.onclick = openAuthModal;

    const historyBtn = el('button', 'ctrl-btn-arch', '\ud83d\udd52 ' + t().history);
    historyBtn.type = 'button';
    historyBtn.id = 'historyBtn';
    historyBtn.style.display = 'none';
    historyBtn.onclick = openHistoryDrawer;

    const userChip = el('div', 'user-chip');
    userChip.id = 'userChip';
    userChip.style.display = 'none';

    wrap.appendChild(historyBtn);
    wrap.appendChild(signInBtn);
    wrap.appendChild(userChip);
    actions.insertBefore(wrap, actions.firstChild);
  }

  function buildAuthModal() {
    if ($('authModal')) return;
    const dlg = document.createElement('dialog');
    dlg.id = 'authModal';
    dlg.className = 'auth-modal';
    dlg.innerHTML = `
      <div class="modal-card auth-modal-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <h2 id="authModalTitle">${t().modalTitle}</h2>
          </div>
          <button type="button" id="authModalClose" class="modal-close-btn" aria-label="${t().close}">&times;</button>
        </div>
        <div class="modal-body auth-modal-body">
          <div class="auth-tabs" role="tablist">
            <button type="button" class="auth-tab active" id="authTabEmail" role="tab">${t().tabEmail}</button>
            <button type="button" class="auth-tab" id="authTabPhone" role="tab">${t().tabPhone}</button>
          </div>

          <div id="authNotConfiguredNotice" class="auth-notice" style="display:${configured ? 'none' : 'flex'}">
            ${t().notConfigured}
          </div>

          <form id="authEmailForm" class="auth-form">
            <label class="auth-label" for="authEmailInput">${t().emailLabel}</label>
            <input type="email" id="authEmailInput" class="auth-input" placeholder="${t().emailPlaceholder}" autocomplete="email" required />
            <button type="submit" class="btn-primary-auth" id="authEmailSubmit">${t().sendLink}</button>
          </form>

          <form id="authPhoneForm" class="auth-form" style="display:none">
            <label class="auth-label" for="authPhoneInput">${t().phoneLabel}</label>
            <input type="tel" id="authPhoneInput" class="auth-input" placeholder="+91 98765 43210" autocomplete="tel" />
            <button type="submit" class="btn-primary-auth" id="authPhoneSendBtn">${t().sendCode}</button>

            <div id="authOtpBlock" style="display:none">
              <label class="auth-label" for="authOtpInput">${t().codeLabel}</label>
              <input type="text" id="authOtpInput" class="auth-input auth-otp-input" inputmode="numeric" maxlength="6" placeholder="000000" />
              <button type="button" class="btn-primary-auth" id="authOtpVerifyBtn">${t().verifyCode}</button>
              <button type="button" class="btn-link-auth" id="authResendBtn">${t().resend}</button>
            </div>
          </form>

          <div id="authStatusMsg" class="auth-status" role="status" aria-live="polite"></div>

          <div class="auth-divider"><span>or</span></div>
          <button type="button" class="btn-guest-auth" id="authGuestBtn">${t().guestContinue}</button>
          <p class="auth-guest-note">${t().guestNote}</p>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    $('authModalClose').onclick = closeAuthModal;
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeAuthModal(); });
    $('authGuestBtn').onclick = closeAuthModal;

    $('authTabEmail').onclick = () => switchAuthTab('email');
    $('authTabPhone').onclick = () => switchAuthTab('phone');

    $('authEmailForm').onsubmit = onEmailSubmit;
    $('authPhoneForm').onsubmit = (e) => e.preventDefault();
    $('authPhoneSendBtn').onclick = onPhoneSendCode;
    $('authOtpVerifyBtn').onclick = onPhoneVerify;
    $('authResendBtn').onclick = onPhoneSendCode;
  }

  function switchAuthTab(which) {
    $('authTabEmail').classList.toggle('active', which === 'email');
    $('authTabPhone').classList.toggle('active', which === 'phone');
    $('authEmailForm').style.display = which === 'email' ? 'flex' : 'none';
    $('authPhoneForm').style.display = which === 'phone' ? 'flex' : 'none';
    setStatus('');
  }

  function setStatus(msg, isError) {
    const box = $('authStatusMsg');
    if (!box) return;
    box.textContent = msg || '';
    box.classList.toggle('auth-status-error', !!isError);
    box.style.display = msg ? 'block' : 'none';
  }

  function openAuthModal() {
    buildAuthModal();
    const dlg = $('authModal');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeAuthModal() {
    const dlg = $('authModal');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  async function onEmailSubmit(e) {
    e.preventDefault();
    const email = $('authEmailInput').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setStatus(t().invalidEmail, true);
    if (!configured) return setStatus(t().notConfigured, true);
    $('authEmailSubmit').disabled = true;
    setStatus('\u2026');
    try {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
      if (error) throw error;
      setStatus(t().linkSent, false);
    } catch (_err) {
      setStatus(t().genericError, true);
    } finally {
      $('authEmailSubmit').disabled = false;
    }
  }

  async function onPhoneSendCode() {
    const phone = $('authPhoneInput').value.trim();
    if (!/^\+?[1-9]\d{7,14}$/.test(phone.replace(/\s+/g, ''))) return setStatus(t().invalidPhone, true);
    if (!configured) return setStatus(t().notConfigured, true);
    pendingPhone = phone.replace(/\s+/g, '');
    $('authPhoneSendBtn').disabled = true;
    setStatus('\u2026');
    try {
      const { error } = await sb.auth.signInWithOtp({ phone: pendingPhone });
      if (error) throw error;
      $('authOtpBlock').style.display = 'block';
      setStatus(t().codeSent, false);
    } catch (_err) {
      setStatus(t().genericError, true);
    } finally {
      $('authPhoneSendBtn').disabled = false;
    }
  }

  async function onPhoneVerify() {
    const code = $('authOtpInput').value.trim();
    if (!/^\d{6}$/.test(code)) return setStatus(t().invalidCode, true);
    $('authOtpVerifyBtn').disabled = true;
    setStatus('\u2026');
    try {
      const { error } = await sb.auth.verifyOtp({ phone: pendingPhone, token: code, type: 'sms' });
      if (error) throw error;
      closeAuthModal();
    } catch (_err) {
      setStatus(t().genericError, true);
    } finally {
      $('authOtpVerifyBtn').disabled = false;
    }
  }

  // --- Session state -> header UI ---
  function renderAuthState() {
    const signInBtn = $('signInBtn');
    const historyBtn = $('historyBtn');
    const userChip = $('userChip');
    if (!signInBtn || !userChip) return;
    if (session?.user) {
      const label = session.user.email || session.user.phone || t().guest;
      signInBtn.style.display = 'none';
      historyBtn.style.display = 'inline-flex';
      userChip.style.display = 'flex';
      userChip.innerHTML = `<span class="user-chip-dot"></span><span class="user-chip-label" title="${t().signedInAs}">${label}</span><button type="button" class="user-chip-signout" id="signOutBtn">${t().signOut}</button>`;
      $('signOutBtn').onclick = async () => { if (sb) await sb.auth.signOut(); };
    } else {
      signInBtn.style.display = 'inline-flex';
      historyBtn.style.display = 'none';
      userChip.style.display = 'none';
      userChip.innerHTML = '';
    }
  }

  // --- Search history: drawer + Supabase CRUD ---
  function buildHistoryDrawer() {
    if ($('historyDrawer')) return;
    const aside = document.createElement('aside');
    aside.id = 'historyDrawer';
    aside.className = 'history-drawer';
    aside.setAttribute('aria-label', t().historyTitle);
    aside.innerHTML = `
      <div class="history-drawer-header">
        <h2>${t().historyTitle}</h2>
        <div class="history-drawer-actions">
          <button type="button" id="historyClearBtn" class="btn-link-auth">${t().clearAll}</button>
          <button type="button" id="historyCloseBtn" class="modal-close-btn" aria-label="${t().close}">&times;</button>
        </div>
      </div>
      <div id="historyDrawerBody" class="history-drawer-body"></div>`;
    document.body.appendChild(aside);

    const scrim = document.createElement('div');
    scrim.id = 'historyScrim';
    scrim.className = 'history-scrim';
    document.body.appendChild(scrim);

    $('historyCloseBtn').onclick = closeHistoryDrawer;
    scrim.onclick = closeHistoryDrawer;
    $('historyClearBtn').onclick = onClearAllHistory;
  }

  function openHistoryDrawer() {
    buildHistoryDrawer();
    $('historyDrawer').classList.add('open');
    $('historyScrim').classList.add('open');
    loadAndRenderHistory();
  }
  function closeHistoryDrawer() {
    $('historyDrawer')?.classList.remove('open');
    $('historyScrim')?.classList.remove('open');
  }

  function groupByDate(rows) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = new Date(today.getTime() - 864e5);
    const groups = { today: [], yesterday: [], earlier: [] };
    rows.forEach((r) => {
      const d = new Date(r.created_at);
      const dOnly = new Date(d); dOnly.setHours(0, 0, 0, 0);
      if (dOnly.getTime() === today.getTime()) groups.today.push(r);
      else if (dOnly.getTime() === yest.getTime()) groups.yesterday.push(r);
      else groups.earlier.push(r);
    });
    return groups;
  }

  async function loadAndRenderHistory() {
    const body = $('historyDrawerBody');
    if (!body) return;
    body.innerHTML = '<div class="history-loading">\u2026</div>';
    if (!configured || !session?.user) {
      body.innerHTML = `<p class="history-empty">${t().empty}</p>`;
      return;
    }
    const { data, error } = await sb
      .from('search_history')
      .select('id, question, lang, location, topic, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data || !data.length) {
      body.innerHTML = `<p class="history-empty">${t().empty}</p>`;
      return;
    }
    const groups = groupByDate(data);
    body.innerHTML = '';
    [['today', t().today], ['yesterday', t().yesterday], ['earlier', t().earlier]].forEach(([key, label]) => {
      if (!groups[key].length) return;
      const section = el('div', 'history-group');
      section.appendChild(el('h3', 'history-group-label', label));
      groups[key].forEach((row) => section.appendChild(renderHistoryRow(row)));
      body.appendChild(section);
    });
  }

  function renderHistoryRow(row) {
    const item = el('div', 'history-item');
    const time = new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const main = el('button', 'history-item-main');
    main.type = 'button';
    main.innerHTML = `<span class="history-item-q">${row.question}</span>` +
      `<span class="history-item-meta">${[row.location, row.topic].filter(Boolean).join(' \u00b7 ')} \u00b7 ${time}</span>`;
    main.onclick = () => {
      closeHistoryDrawer();
      window.dispatchEvent(new CustomEvent('aerocast:reask', { detail: { text: row.question } }));
    };

    const del = el('button', 'history-item-del', '\u2715');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete');
    del.onclick = async (e) => {
      e.stopPropagation();
      await sb.from('search_history').delete().eq('id', row.id);
      loadAndRenderHistory();
    };

    item.appendChild(main);
    item.appendChild(del);
    return item;
  }

  async function onClearAllHistory() {
    if (!session?.user) return;
    if (!window.confirm(t().confirmClear)) return;
    await sb.from('search_history').delete().eq('user_id', session.user.id);
    loadAndRenderHistory();
  }

  async function logQuery(detail) {
    if (!configured || !session?.user || !detail?.question) return;
    try {
      await sb.from('search_history').insert({
        user_id: session.user.id,
        question: detail.question,
        lang: detail.lang || 'en',
        location: detail.location || null,
        topic: detail.topic || null
      });
    } catch (_e) { /* best-effort: never block the chat UI on logging failures */ }
  }

  // --- Wire-up ---
  function init() {
    buildHeaderControls();
    renderAuthState();

    if (configured) {
      sb.auth.getSession().then(({ data }) => { session = data?.session || null; renderAuthState(); });
      sb.auth.onAuthStateChange((_event, s) => { session = s; renderAuthState(); if (s) closeAuthModal(); });
    }

    window.addEventListener('aerocast:query-answered', (e) => logQuery(e.detail));

    window.addEventListener('aerocast:lang-changed', () => {
      // Re-render header text in the new language; drop the modal/drawer so
      // they rebuild fresh (with fresh translations) the next time they open.
      $('authControls')?.remove();
      buildHeaderControls();
      renderAuthState();
      $('authModal')?.remove();
      $('historyDrawer')?.remove();
      $('historyScrim')?.remove();
    });

    // README-documented deep link: index.html?auth=1 opens the sign-in modal directly.
    if (new URLSearchParams(window.location.search).get('auth') === '1') {
      setTimeout(openAuthModal, 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
