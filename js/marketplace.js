/**
 * Volta Coach Marketplace — Browse, hire, and pay coaches
 * ========================================================
 *
 * This module powers the coach marketplace in the athlete's "My Coach" tab.
 * Athletes can browse a directory of coaches, view their profiles, and "hire"
 * a coach by paying a fee. The app takes a 10% platform fee; the coach
 * receives the remaining 90%.
 *
 * FEATURES:
 *   - Browse a directory of coaches (seeded + user-created)
 *   - Filter by specialty, price range, rating
 *   - View coach profile (bio, cert, specialty, price, rating, reviews)
 *   - Hire a coach (fake payment → athlete added to coach's roster)
 *   - 10% platform fee (90% to coach)
 *   - Coaches see paid athletes in their roster with a payment badge
 *
 * DATA STORAGE:
 *   - Coach directory: extends volta_coach_users with marketplace fields
 *     (bio, photoUrl, location, pricePerMonth, rating, reviewCount,
 *      yearsExperience, languages, isPublished, isVerified)
 *   - Athlete-coach payment records: stored on the athlete record as
 *     { paid: true, paidAmount, paidAt, platformFee }
 *   - Seed coaches: seeded on first load via VoltaMarketplace.seedCoaches()
 */

window.VoltaMarketplace = (function () {

  const PLATFORM_FEE_PERCENT = 0.10; // 10% platform fee

  // ─── Seed coach data (6 demo coaches) ────────────────────────────────────
  const SEED_COACHES = [
    {
      fullName: 'Alex Rivera', email: 'alex.rivera@volta.coach',
      cert: 'NASM', specialty: 'Strength & Conditioning',
      bio: 'Former competitive powerlifter with 8 years of coaching experience. I specialize in building strength and muscle for athletes of all levels. My programs are science-based and tailored to your specific goals.',
      location: 'New York, USA', pricePerMonth: 49.99,
      rating: 4.9, reviewCount: 127, yearsExperience: 8,
      languages: ['English', 'Spanish'], isPublished: true, isVerified: true,
      pwdHash: 'seed_1', _seeded: true
    },
    {
      fullName: 'Sara Chen', email: 'sara.chen@volta.coach',
      cert: 'ACE', specialty: 'Weight loss',
      bio: 'Registered dietitian and certified personal trainer. I help clients achieve sustainable weight loss through balanced nutrition and effective workouts. No crash diets, just real results.',
      location: 'San Francisco, USA', pricePerMonth: 39.99,
      rating: 4.8, reviewCount: 89, yearsExperience: 6,
      languages: ['English', 'Mandarin'], isPublished: true, isVerified: true,
      pwdHash: 'seed_2', _seeded: true
    },
    {
      fullName: 'Omar Hassan', email: 'omar.hassan@volta.coach',
      cert: 'NSCA', specialty: 'Endurance / Running',
      bio: 'Marathon coach and former Olympic trial qualifier. I\'ve helped over 200 runners achieve personal bests from 5K to ultramarathons. Whether you\'re a beginner or aiming for Boston, I\'ll get you there.',
      location: 'Dubai, UAE', pricePerMonth: 59.99,
      rating: 5.0, reviewCount: 203, yearsExperience: 12,
      languages: ['Arabic', 'English'], isPublished: true, isVerified: true,
      pwdHash: 'seed_3', _seeded: true
    },
    {
      fullName: 'Emma Wilson', email: 'emma.wilson@volta.coach',
      cert: 'ISSA', specialty: 'Yoga & Mobility',
      bio: '500-hour RYT yoga teacher with a passion for helping people move better. I combine yoga, mobility work, and corrective exercise to improve flexibility, reduce pain, and enhance performance.',
      location: 'London, UK', pricePerMonth: 34.99,
      rating: 4.7, reviewCount: 156, yearsExperience: 7,
      languages: ['English'], isPublished: true, isVerified: true,
      pwdHash: 'seed_4', _seeded: true
    },
    {
      fullName: 'Marcus Johnson', email: 'marcus.johnson@volta.coach',
      cert: 'NASM', specialty: 'Sports performance',
      bio: 'Strength and conditioning coach for professional basketball and football players. I bring elite-level training methods to serious athletes who want to take their performance to the next level.',
      location: 'Los Angeles, USA', pricePerMonth: 79.99,
      rating: 4.9, reviewCount: 78, yearsExperience: 10,
      languages: ['English'], isPublished: true, isVerified: true,
      pwdHash: 'seed_5', _seeded: true
    },
    {
      fullName: 'Layla Ahmed', email: 'layla.ahmed@volta.coach',
      cert: 'ACE', specialty: 'Rehabilitation',
      bio: 'Physical therapist and certified trainer specializing in post-injury rehabilitation. I help clients safely return to training after injuries, with a focus on long-term health and injury prevention.',
      location: 'Cairo, Egypt', pricePerMonth: 44.99,
      rating: 4.8, reviewCount: 94, yearsExperience: 9,
      languages: ['Arabic', 'English', 'French'], isPublished: true, isVerified: true,
      pwdHash: 'seed_6', _seeded: true
    }
  ];

  // ─── Internal: get current user ──────────────────────────────────────────
  function user() {
    try {
      if (typeof currentUser === 'function') return currentUser();
      if (typeof store !== 'undefined' && store.session) return store.users[store.session];
      return null;
    } catch (e) { return null; }
  }

  // ─── Internal: get all coach users ───────────────────────────────────────
  function getCoachUsers() {
    try {
      if (typeof window.getCoachUsers === 'function') return window.getCoachUsers();
      return JSON.parse(localStorage.getItem('volta_coach_users') || '{}');
    } catch (e) { return {}; }
  }

  // ─── Internal: save coach users ──────────────────────────────────────────
  function saveCoachUsers(users) {
    try {
      localStorage.setItem('volta_coach_users', JSON.stringify(users));
    } catch (e) {}
  }

  // ─── Public: seed demo coaches if not already seeded ─────────────────────
  function seedCoaches() {
    var coaches = getCoachUsers();
    var changed = false;
    SEED_COACHES.forEach(function (sc) {
      if (!coaches[sc.email]) {
        coaches[sc.email] = sc;
        changed = true;
      }
    });
    if (changed) saveCoachUsers(coaches);
    return changed;
  }

  // ─── Public: get all published coaches (marketplace listing) ─────────────
  function getPublishedCoaches() {
    var coaches = getCoachUsers();
    var result = [];
    for (var email in coaches) {
      var c = coaches[email];
      if (c.isPublished) result.push(c);
    }
    return result;
  }

  // ─── Public: get a single coach by email ─────────────────────────────────
  function getCoach(email) {
    var coaches = getCoachUsers();
    return coaches[email] || null;
  }

  // ─── Public: filter coaches ──────────────────────────────────────────────
  function filterCoaches(opts) {
    opts = opts || {};
    var coaches = getPublishedCoaches();
    if (opts.specialty) coaches = coaches.filter(function (c) { return c.specialty === opts.specialty; });
    if (opts.maxPrice) coaches = coaches.filter(function (c) { return c.pricePerMonth <= opts.maxPrice; });
    if (opts.minRating) coaches = coaches.filter(function (c) { return c.rating >= opts.minRating; });
    if (opts.search) {
      var q = opts.search.toLowerCase();
      coaches = coaches.filter(function (c) {
        return (c.fullName && c.fullName.toLowerCase().indexOf(q) !== -1) ||
               (c.bio && c.bio.toLowerCase().indexOf(q) !== -1) ||
               (c.specialty && c.specialty.toLowerCase().indexOf(q) !== -1) ||
               (c.location && c.location.toLowerCase().indexOf(q) !== -1);
      });
    }
    // Sort by rating (highest first)
    coaches.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    return coaches;
  }

  // ─── Public: check if athlete has already hired a coach ──────────────────
  function hasHiredCoach(coachEmail) {
    try {
      var allAthletes = JSON.parse(localStorage.getItem('volta_coach_athletes') || '{}');
      var myEmail = (typeof store !== 'undefined' && store.session) ? store.session.toLowerCase() : '';
      var roster = allAthletes[coachEmail] || [];
      return roster.some(function (a) {
        return (a.email || '').toLowerCase() === myEmail && a.paid === true;
      });
    } catch (e) { return false; }
  }

  // ─── Public: hire a coach (process payment + add to roster) ──────────────
  function hireCoach(coachEmail, cardData) {
    var coach = getCoach(coachEmail);
    if (!coach) return { success: false, error: 'Coach not found' };
    if (hasHiredCoach(coachEmail)) return { success: false, error: 'You have already hired this coach' };

    var u = user();
    if (!u) return { success: false, error: 'Please log in first' };

    var price = coach.pricePerMonth || 0;
    var platformFee = Math.round(price * PLATFORM_FEE_PERCENT * 100) / 100;
    var coachPayout = Math.round((price - platformFee) * 100) / 100;

    // Add athlete to coach's roster with payment info
    try {
      var allAthletes = JSON.parse(localStorage.getItem('volta_coach_athletes') || '{}');
      if (!allAthletes[coachEmail]) allAthletes[coachEmail] = [];
      var name = (u.profile && u.profile.name) ? u.profile.name : u.email.split('@')[0];
      var initials = name.split(' ').map(function (n) { return n.charAt(0); }).join('').toUpperCase().slice(0, 2);
      allAthletes[coachEmail].push({
        id: Date.now(),
        name: name,
        email: u.email,
        sport: (u.profile && u.profile.sport) || 'General Fitness',
        level: (u.survey && u.survey.level) || 'Beginner',
        notes: '',
        initials: initials,
        streak: 0,
        sessions: 0,
        status: 'new',
        addedAt: new Date().toISOString(),
        sessionLog: [],
        assignedPlan: null,
        lastSessionDate: null,
        goals: '',
        injuryNotes: '',
        phone: '',
        // Marketplace payment fields
        paid: true,
        paidAmount: price,
        platformFee: platformFee,
        coachPayout: coachPayout,
        paidAt: new Date().toISOString(),
        hiredViaMarketplace: true
      });
      localStorage.setItem('volta_coach_athletes', JSON.stringify(allAthletes));
      return { success: true, coach: coach, platformFee: platformFee, coachPayout: coachPayout };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─── Public: render the coach directory ──────────────────────────────────
  function renderDirectory(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');

    var coaches = filterCoaches({});
    if (coaches.length === 0) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">' + (ar ? 'لا توجد مدربون متاحون حالياً.' : 'No coaches available right now.') + '</p>';
      return;
    }

    var html = '<div class="coach-directory-grid">';
    coaches.forEach(function (c) {
      var stars = renderStars(c.rating);
      var alreadyHired = hasHiredCoach(c.email);
      var btnHtml = alreadyHired
        ? '<button class="btn ghost small" disabled style="width:100%;color:var(--green);border-color:var(--green);"><i class="fa-solid fa-check"></i> ' + (ar ? 'تم التوظيف' : 'Hired') + '</button>'
        : '<button class="btn primary small" style="width:100%;" onclick="VoltaMarketplace.openCoachProfile(\'' + c.email + '\')">' + (ar ? 'عرض الملف' : 'View Profile') + '</button>';

      html += '<div class="coach-card">' +
        '<div class="coach-card-header">' +
          '<div class="coach-card-avatar">' + (c.fullName || '?').charAt(0).toUpperCase() + '</div>' +
          '<div class="coach-card-info">' +
            '<b>' + esc(c.fullName) + '</b>' +
            '<small style="color:var(--muted);">' + esc(c.specialty) + '</small>' +
            '<div class="coach-card-rating">' + stars + ' <span style="font-size:.75rem;color:var(--muted);">' + c.rating + ' (' + c.reviewCount + ')</span></div>' +
          '</div>' +
        '</div>' +
        '<p class="coach-card-bio">' + esc(c.bio.slice(0, 120)) + (c.bio.length > 120 ? '...' : '') + '</p>' +
        '<div class="coach-card-meta">' +
          '<span><i class="fa-solid fa-certificate" style="color:var(--accent);"></i> ' + esc(c.cert) + '</span>' +
          '<span><i class="fa-solid fa-location-dot" style="color:var(--accent);"></i> ' + esc(c.location) + '</span>' +
          '<span><i class="fa-solid fa-clock" style="color:var(--accent);"></i> ' + c.yearsExperience + (ar ? ' سنوات' : ' yrs') + '</span>' +
        '</div>' +
        '<div class="coach-card-price">' +
          '<b style="font-size:1.3rem;color:var(--accent);">$' + c.pricePerMonth + '</b>' +
          '<small style="color:var(--muted);">' + (ar ? '/شهر' : '/mo') + '</small>' +
        '</div>' +
        btnHtml +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // ─── Internal: render star rating ────────────────────────────────────────
  function renderStars(rating) {
    var full = Math.floor(rating);
    var half = (rating - full) >= 0.5;
    var html = '';
    for (var i = 0; i < full; i++) html += '<i class="fa-solid fa-star" style="color:#ffc107;font-size:.75rem;"></i>';
    if (half) html += '<i class="fa-solid fa-star-half-stroke" style="color:#ffc107;font-size:.75rem;"></i>';
    for (var j = full + (half ? 1 : 0); j < 5; j++) html += '<i class="fa-regular fa-star" style="color:#ffc107;font-size:.75rem;"></i>';
    return html;
  }

  // ─── Internal: escape HTML ───────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Public: open coach profile modal ────────────────────────────────────
  function openCoachProfile(coachEmail) {
    var coach = getCoach(coachEmail);
    if (!coach) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    var alreadyHired = hasHiredCoach(coachEmail);

    var stars = renderStars(coach.rating);
    var languages = (coach.languages || []).join(', ');

    var html = `
      <div class="coach-profile-modal">
        <div class="coach-profile-header">
          <div class="coach-profile-avatar">${esc((coach.fullName || '?').charAt(0).toUpperCase())}</div>
          <div>
            <h2 style="margin:0;">${esc(coach.fullName)}</h2>
            <p style="color:var(--muted);margin:4px 0;">${esc(coach.specialty)}</p>
            <div>${stars} <span style="color:var(--muted);font-size:.85rem;">${coach.rating} (${coach.reviewCount} ${ar ? 'تقييم' : 'reviews'})</span></div>
          </div>
        </div>
        <div class="coach-profile-section">
          <h4>${ar ? 'نبذة' : 'About'}</h4>
          <p style="color:var(--muted);line-height:1.5;">${esc(coach.bio)}</p>
        </div>
        <div class="coach-profile-section">
          <h4>${ar ? 'التفاصيل' : 'Details'}</h4>
          <div class="coach-profile-details">
            <div><i class="fa-solid fa-certificate" style="color:var(--accent);"></i> <b>${ar ? 'الشهادة' : 'Certification'}:</b> ${esc(coach.cert)}</div>
            <div><i class="fa-solid fa-location-dot" style="color:var(--accent);"></i> <b>${ar ? 'الموقع' : 'Location'}:</b> ${esc(coach.location)}</div>
            <div><i class="fa-solid fa-clock" style="color:var(--accent);"></i> <b>${ar ? 'الخبرة' : 'Experience'}:</b> ${coach.yearsExperience} ${ar ? 'سنوات' : 'years'}</div>
            <div><i class="fa-solid fa-language" style="color:var(--accent);"></i> <b>${ar ? 'اللغات' : 'Languages'}:</b> ${esc(languages)}</div>
          </div>
        </div>
        <div class="coach-profile-pricing">
          <div>
            <b style="font-size:1.8rem;color:var(--accent);">$${coach.pricePerMonth}</b>
            <small style="color:var(--muted);">${ar ? '/شهر' : '/month'}</small>
          </div>
          <small style="color:var(--muted);">${ar ? 'يشمل خطط مخصصة، تتبع الجلسات، ودعم مباشر' : 'Includes custom plans, session tracking, and direct support'}</small>
        </div>
        ${alreadyHired
          ? '<button class="btn ghost" style="width:100%;color:var(--green);border-color:var(--green);" disabled><i class="fa-solid fa-check"></i> ' + (ar ? 'أنت عميل لهذا المدرب' : 'You are a client of this coach') + '</button>'
          : '<button class="btn primary" style="width:100%;padding:14px;font-size:1rem;" onclick="VoltaMarketplace.openPayment(\'' + coachEmail + '\')">' + (ar ? 'توظيف هذا المدرب' : 'Hire This Coach') + '</button>'
        }
        <p style="font-size:.75rem;color:var(--muted);text-align:center;margin-top:10px;">${ar ? 'رسوم المنصة 10% — المدرب يحصل على 90%' : '10% platform fee — coach receives 90%'}</p>
      </div>
    `;

    var modal = document.getElementById('coach-profile-modal');
    var body = document.getElementById('coach-profile-modal-body');
    if (body) body.innerHTML = html;
    if (modal && typeof openModal === 'function') openModal('coach-profile-modal');
  }

  // ─── Public: open payment modal for hiring a coach ───────────────────────
  function openPayment(coachEmail) {
    var coach = getCoach(coachEmail);
    if (!coach) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');

    // Close profile modal
    if (typeof closeModal === 'function') closeModal('coach-profile-modal');

    // Try real Stripe Checkout first, fall back to demo payment
    tryCoachStripeCheckout(coach);
  }

  // ─── Internal: try real Stripe Checkout for coach hiring ─────────────────
  async function tryCoachStripeCheckout(coach) {
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    var API_URL = window.VOLTA_API_BASE || window.location.origin;
    var userEmail = (typeof store !== 'undefined' && store.session) ? store.session : '';

    try {
      var response = await fetch(API_URL + '/api/create-coach-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachEmail: coach.email,
          coachName: coach.fullName,
          price: coach.pricePerMonth,
          userEmail: userEmail
        })
      });

      if (!response.ok) throw new Error('Backend returned ' + response.status);
      var data = await response.json();

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
        return;
      }
      throw new Error('No checkout URL returned');
    } catch (err) {
      // Backend not available — show error (no demo fallback)
      console.error('[VoltaMarketplace] Payment error:', err.message);
      try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'خطأ في الخادم — تأكد من تشغيل الخادم الخلفي.' : 'Server error — make sure the backend server is running.', 'error'); } catch (e) {}
    }
  }

  // ─── Card formatting (reuse from premium.js) ─────────────────────────────
  function formatCardNumber(input) {
    var v = input.value.replace(/\D/g, '').slice(0, 16);
    input.value = v.replace(/(.{4})/g, '$1 ').trim();
  }

  function formatCardExpiry(input) {
    var v = input.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v;
  }

  // ─── Internal: validate card form ────────────────────────────────────────
  function validateCardForm() {
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    var name = (document.getElementById('coach-pay-card-name').value || '').trim();
    var num = (document.getElementById('coach-pay-card-number').value || '').replace(/\s/g, '');
    var exp = (document.getElementById('coach-pay-card-expiry').value || '').trim();
    var cvc = (document.getElementById('coach-pay-card-cvc').value || '').trim();
    var zip = (document.getElementById('coach-pay-card-zip').value || '').trim();

    function showErr(msg, fieldId) {
      var errEl = document.getElementById('coach-pay-error');
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      if (fieldId) { var f = document.getElementById(fieldId); if (f) f.style.borderColor = 'var(--red)'; }
    }

    if (name.length < 2) { showErr(ar ? 'الرجاء إدخال اسم حامل البطاقة.' : 'Please enter the cardholder name.', 'coach-pay-card-name'); return false; }
    if (num.length < 13 || num.length > 16) { showErr(ar ? 'رقم البطاقة غير صالح.' : 'Invalid card number.', 'coach-pay-card-number'); return false; }
    var luhn = 0, dbl = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = parseInt(num.charAt(i), 10);
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      luhn += d; dbl = !dbl;
    }
    if (luhn % 10 !== 0) { showErr(ar ? 'رقم البطاقة غير صالح.' : 'Invalid card number.', 'coach-pay-card-number'); return false; }
    var m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) { showErr(ar ? 'تاريخ الانتهاء غير صالح.' : 'Invalid expiry date.', 'coach-pay-card-expiry'); return false; }
    if (!/^\d{3,4}$/.test(cvc)) { showErr(ar ? 'رمز الأمان غير صالح.' : 'Invalid CVC.', 'coach-pay-card-cvc'); return false; }
    if (zip.length < 4) { showErr(ar ? 'الرجاء إدخال الرمز البريدي.' : 'Please enter your ZIP / postal code.', 'coach-pay-card-zip'); return false; }
    var errEl = document.getElementById('coach-pay-error');
    if (errEl) errEl.style.display = 'none';
    return true;
  }

  // ─── Public: process coach payment ───────────────────────────────────────
  function processPayment() {
    if (!validateCardForm()) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    var modal = document.getElementById('coach-payment-modal');
    var coachEmail = modal ? modal.dataset.coachEmail : null;
    if (!coachEmail) return;

    var btn = document.getElementById('coach-pay-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (ar ? 'جارٍ المعالجة...' : 'Processing...');
    }

    setTimeout(function () {
      var result = hireCoach(coachEmail);
      if (result.success) {
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + (ar ? 'تم التوظيف!' : 'Hired!');
          btn.style.background = 'var(--green)';
        }
        setTimeout(function () {
          if (typeof closeModal === 'function') closeModal('coach-payment-modal');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = ar ? 'ادفع وتوظيف المدرب' : 'Pay & Hire Coach';
            btn.style.background = '';
          }
          // Re-render the directory + my coach section
          renderDirectory('coach-directory');
          try { if (typeof renderMyCoach === 'function') renderMyCoach(); } catch (e) {}
          try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'تم توظيف المدرب بنجاح!' : 'Coach hired successfully!', 'success'); } catch (e) {}
        }, 1500);
      } else {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = ar ? 'ادفع وتوظيف المدرب' : 'Pay & Hire Coach';
        }
        var errEl = document.getElementById('coach-pay-error');
        if (errEl) {
          errEl.textContent = ar ? result.error : result.error;
          errEl.style.display = 'block';
        }
      }
    }, 2200);
  }

  return {
    seedCoaches: seedCoaches,
    getPublishedCoaches: getPublishedCoaches,
    getCoach: getCoach,
    filterCoaches: filterCoaches,
    hasHiredCoach: hasHiredCoach,
    hireCoach: hireCoach,
    renderDirectory: renderDirectory,
    openCoachProfile: openCoachProfile,
    openPayment: openPayment,
    processPayment: processPayment,
    formatCardNumber: formatCardNumber,
    formatCardExpiry: formatCardExpiry,
    PLATFORM_FEE_PERCENT: PLATFORM_FEE_PERCENT
  };
})();
