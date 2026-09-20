/**
 * Volta Local AI — fully on-device engines for the 4 premium features
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: the premium features used to hard-fail with
 * "Failed to fetch" whenever the Volta cloud (Vercel) could not be reached
 * (offline testing, stale deployment, no GEMINI key yet…). Every feature
 * now has a REAL local engine, so it ALWAYS works — and the cloud AI
 * (richer, personalized) automatically takes over when reachable.
 *
 *   1. MotionRepCounter — AUTO-COUNTS reps from live camera frames using
 *      frame-differencing + block-matching vertical-shift estimation.
 *      No net, no tapping: every DOWN→UP cycle of the body = 1 rep, with
 *      per-rep analytics (amplitude→ROM, left/right split, tempo) fed to
 *      the form checker. Core pipeline (processGray) is DOM-free and
 *      unit-testable from Node.
 *   2. formCheckLocal   — v7 MULTI-RESULT, per-exercise form verdict:
 *      reads what the camera ACTUALLY measured in THIS set and answers
 *      with SEVERAL findings (rhythm vs the exercise's ideal tempo
 *      window, pacing consistency, range-of-motion consistency, L/R
 *      balance, stability + the exercise's own technique focus), each
 *      citing the user's real numbers. Bilingual (opts.lang).
 *   3. progressionLocal — the same ≤10% safe-progression rule the server
 *      uses, computed from the user's last logs.
 *   4. recoveryLocal    — condition-aware, MULTI-ANSWER recovery model:
 *      48h fatigue-decay over the last 7 days of sessions + soreness /
 *      sleep / energy / sore-area inputs + the user's injury → per-muscle
 *      readiness PLUS several direct answers, concrete recovery actions
 *      and an injury note. Bilingual (opts.lang).
 *
 * Everything here is deterministic, dependency-free and runs in ~1-2ms per
 * frame at 48×64 processing resolution.
 * ══════════════════════════════════════════════════════════════════════ */

window.VoltaLocalAI = (function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // 1) MOTION REP COUNTER — on-device, works 100% offline
  // ══════════════════════════════════════════════════════════════════════
  // Core detector: BLOCK-MATCHING vertical shift estimation. Between two
  // consecutive (48×64 grayscale) frames we find the row-shift dy that best
  // aligns the new frame onto the previous one (minimum normalized SAD over
  // all candidate shifts ±SM rows). That dy is the BODY's real vertical
  // displacement — squats/push-ups/rows/curls all oscillate it cleanly.
  //   • dy tracked with a direction state machine (hysteresis + travel gate)
  //     → 1 rep per DOWN→UP cycle.
  //   • Confidence gate: the best shift must beat the zero-shift SAD by a
  //     margin, otherwise the frame counts as noise (camera shake, flat
  //     scenes) and the machine holds state.
  //   • ENERGY fallback: if no confident shift for 3s while motion energy is
  //     high (e.g. uniform clothing, odd lighting), motion-power direction
  //     flips take over — every 2nd flip = 1 rep.
  const PW = 48, PH = 64;          // processing resolution
  const DIFF_T = 13;               // per-pixel threshold (energy mask)
  const SM = 14;                   // max shift searched (rows)
  const CONF_MIN = 0.06;           // min relative SAD improvement to trust dy

  function MotionRepCounter() { this.reset(); }

  MotionRepCounter.prototype.reset = function () {
    this.prev = new Float32Array(PW * PH);
    this.hasPrev = false;
    this.energy = 0;              // smoothed motion energy (0..1)
    this.base = 0;                // noise floor (slow EMA)
    this.dy = 0;                  // smoothed vertical velocity (rows/frame)
    this.pos = 0;                 // integrated position (rows, + = down)
    this.dir = 0;                 // 0 unknown · 1 descending · -1 ascending
    this.minDy = 0; this.maxDy = 0;
    this.reps = 0;
    this.phase = '—';
    this.lastRepAt = 0;
    this.repIntervals = [];       // ms between reps (tempo)
    this.idleSince = 0;
    this.frames = 0;
    this.energyMode = false;      // fallback detector active
    this._lastConfident = 0;
    this._eDir = 0; this._eRef = 0; this._eFlips = 0;
    this._cxs = [];               // horizontal energy centroid (sway metric)
    // v7 — per-rep analytics for the AI form checker:
    this.repLog = [];             // [{t, durMs, amp(rows), sym}] per counted rep
    this._sym = 0.5;              // EMA of LEFT-half motion share (0.5 = balanced)
    this._symN = 0;               // active frames feeding _sym
    this.onRep = null;            // optional callback(reps) — fired on every auto-counted rep
    this._pending = null;         // v7.1 armed rep awaiting ascent confirmation
  }

  MotionRepCounter.prototype._countRep = function (now, amp) {
    this.reps++;
    const durMs = this.lastRepAt ? (now - this.lastRepAt) : 0;
    if (this.lastRepAt) { this.repIntervals.push(durMs); if (this.repIntervals.length > 8) this.repIntervals.shift(); }
    this.repLog.push({ t: now, durMs: durMs, amp: (typeof amp === 'number' && amp > 0) ? amp : 0, sym: this._sym });
    if (this.repLog.length > 80) this.repLog.shift();
    this.lastRepAt = now;
    if (typeof this.onRep === 'function') { try { this.onRep(this.reps); } catch (e) {} }
  };

  /** Process one video frame. Returns {reps, phase, tempoSec, counted, feedback}. */
  MotionRepCounter.prototype.process = function (video, now) {
    if (!video || !video.videoWidth) return { reps: this.reps, phase: this.phase, tempoSec: this.avgTempoSec(), counted: false, feedback: '' };
    if (!this._cv) {
      this._cv = document.createElement('canvas');
      this._cv.width = PW; this._cv.height = PH;
      this._ctx = this._cv.getContext('2d', { willReadFrequently: true });
    }
    let data;
    try {
      this._ctx.drawImage(video, 0, 0, PW, PH);
      data = this._ctx.getImageData(0, 0, PW, PH).data;
    } catch (e) { return { reps: this.reps, phase: this.phase, tempoSec: this.avgTempoSec(), counted: false, feedback: '' }; }
    // grayscale only — ALL analysis lives in processGray (browser-free,
    // unit-testable, shared by the camera path and the test harness).
    const cur = this._gray || (this._gray = new Float32Array(PW * PH));
    for (let p = 0, i = 0; p < PW * PH; p++, i += 4) {
      cur[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return this.processGray(cur, now);
  };

  /** Core pipeline on a raw grayscale frame (48×64). No DOM involved. */
  MotionRepCounter.prototype.processGray = function (cur, now) {
    const out = { reps: this.reps, phase: this.phase, tempoSec: this.avgTempoSec(), counted: false, feedback: '' };
    const gray = this.prev;
    // diff stats in ONE pass: energy mask, centroid X, LEFT/RIGHT half energies
    let cnt = 0, sumX = 0, sumW = 0, eL = 0, eR = 0;
    for (let p = 0; p < PW * PH; p++) {
      if (!this.hasPrev) break;
      const d = Math.abs(cur[p] - gray[p]);
      if (d > DIFF_T) {
        cnt++; sumW += d; sumX += (p % PW) * d;
        if ((p % PW) < PW / 2) eL += d; else eR += d;
      }
    }
    this.hasPrev = true;
    this.frames++;
    const rawEnergy = cnt / (PW * PH);
    this.energy = this.energy * 0.6 + rawEnergy * 0.4;
    // Asymmetric noise floor: tracks the LOCAL MINIMA of motion energy.
    // (A symmetric EMA ratchets up during sustained exercise until the
    // activity threshold sits ABOVE the movement signal — the counter goes
    // deaf mid-workset. Rising slowly / falling fast pins the floor to the
    // true idle level.)
    if (rawEnergy < this.base) this.base = this.base * 0.90 + rawEnergy * 0.10;
    else this.base = this.base * 0.995 + rawEnergy * 0.005;
    if (cnt > 0 && sumW > 0 && this.energy > 0.004) this._cxs.push(Math.min(PW, Math.max(0, sumX / sumW)));
    if (this._cxs.length > 90) this._cxs.shift();
    // v7 — LEFT/RIGHT motion share (symmetry metric). Only meaningful on
    // genuinely active frames (enough changed pixels to trust the split).
    if (cnt > 4 && (eL + eR) > 0) {
      const lr = eL / (eL + eR);
      this._sym = this._sym * 0.82 + lr * 0.18;
      this._symN++;
    }
    if (this.frames < 4) { gray.set(cur); return out; }

    const active = this.energy > Math.max(this.base * 1.45, 0.006);
    if (!active) {
      gray.set(cur);
      if (!this.idleSince) this.idleSince = now;
      if (now - this.idleSince > 2600) {          // re-arm after a long pause
        this.dir = 0; this.pos = 0; this.dy = 0; this.minDy = 0; this.maxDy = 0; this.phase = '—';
        this._eFlips = 0; this._eDir = 0; this._pending = null;
      }
      out.reps = this.reps; out.phase = this.phase;
      if (this.reps === 0 && this.frames > 45) out.feedback = 'no_movement';
      return out;
    }
    this.idleSince = 0;

    // ── BLOCK-MATCHING: best vertical shift of cur vs prev ──
    let bestDy = 0, bestSad = Infinity, sad0 = Infinity;
    for (let dy = -SM; dy <= SM; dy++) {
      let sad = 0, n = 0;
      const rStart = Math.max(0, dy), rEnd = Math.min(PH, PH + dy);
      for (let r = rStart; r < rEnd; r++) {
        const rowCur = r * PW, rowPrev = (r - dy) * PW;
        for (let c = 0; c < PW; c++) {
          sad += Math.abs(cur[rowCur + c] - gray[rowPrev + c]);
          n++;
        }
      }
      sad /= (n || 1);
      if (dy === 0) sad0 = sad;
      if (sad < bestSad) { bestSad = sad; bestDy = dy; }
    }

    // ── v14 (user): CAMERA-MOTION REJECTION ─────────────────────────────
    // "dont make the ai in rep count, count camera movements as reps, only
    // body movement". The block-matcher above can't tell the two apart: a
    // vertical CAMERA bounce translates the WHOLE frame (background + body)
    // by the same dy, which looks exactly like the body moving — and the
    // direction state machine happily counted full DOWN→UP cycles from it.
    //
    // Discriminator — GLOBAL vs LOCAL coherence, via 3 horizontal bands:
    //   • BODY movement: only the athlete's pixels translate; the static
    //     background bands stay best-aligned at dy=0 → bands DISAGREE with
    //     the global shift → keep counting (this is a real rep signal).
    //   • CAMERA movement: the entire scene translates together → EVERY
    //     band's SAD improves under the same bestDy → bands are UNANIMOUS
    //     AND the whole-frame residual after the shift is near-noise
    //     (a rigid translate aligns almost perfectly; a moving, deforming
    //     body never does) → this frame is CAMERA motion, not a rep.
    //
    // When camera motion is detected the counter HOLDS: no dy accumulation,
    // no phase change, and the ENERGY fallback is frozen too (camera wobble
    // must not flip the motion-power state machine either). The noise floor
    // and energy trackers above keep updating, so the detector re-arms
    // naturally once the camera settles.
    let camMotion = false;
    if (bestDy !== 0 && sad0 > 0) {
      const BANDS = 3, BH = Math.floor(PH / BANDS);
      let followers = 0;
      for (let b = 0; b < BANDS; b++) {
        const r0 = b * BH, r1 = (b === BANDS - 1) ? PH : (b + 1) * BH;
        let s0 = 0, n0 = 0, sS = 0, nS = 0;
        for (let r = r0; r < r1; r++) {
          const rc = r * PW, rp = r - bestDy;
          const rowOK = (rp >= 0 && rp < PH);
          const rowPrev = rowOK ? rp * PW : 0;
          for (let c = 0; c < PW; c++) {
            s0 += Math.abs(cur[rc + c] - gray[rc + c]); n0++;
            if (rowOK) { sS += Math.abs(cur[rc + c] - gray[rowPrev + c]); nS++; }
          }
        }
        // band "follows" the global shift when shifting clearly helps it
        if (n0 > 0 && nS > 0 && (sS / nS) < (s0 / n0) * 0.92) followers++;
      }
      camMotion = (followers === BANDS) &&
                  (bestSad < Math.min(12, sad0 * 0.55));
    }
    // ── v15 (user): HINGE / ROTATION / GLOBAL-CHANGE REJECTION ───────────
    // "when i move my laptop's hinge, it counts as a pushup, make the ai
    // detect body movement only". A hinge tilt doesn't translate the frame
    // like the v14 check expects — it ROTATES + rescales + re-exposes the
    // whole scene, so no vertical shift aligns it, the residual stays high
    // and the v14 discriminator waved it through as "body movement".
    // Two new whole-frame discriminators, same hold path as v14:
    //   A) 3×3 ZONE GRID — body movement always leaves QUIET background
    //      zones (the room behind the athlete is static); a global warp
    //      (rotate / scale / exposure change / big shake) changes EVERY
    //      zone. ≤1 quiet zone + ≥40% of the frame changed → camera.
    //   B) PER-BAND SHIFT SIGN — a real rotation pushes the top and the
    //      bottom of the frame in OPPOSITE vertical directions (top rows
    //      one way, bottom rows the other). A body can never do that: the
    //      athlete's pixels move together, the background stays at dy≈0.
    if (!camMotion) {
      // B) rotation signature — independent best shift of top vs bottom band
      const BANDS2 = 3, BH2 = Math.floor(PH / BANDS2);
      let dyTop = 0, dyBot = 0, okTop = false, okBot = false;
      for (let b = 0; b <= 2; b += 2) {          // bands 0 (top) and 2 (bottom)
        const r0 = b * BH2, r1 = (b === 2) ? PH : (b + 1) * BH2;
        let bb = 0, bsad = Infinity, b0 = Infinity;
        for (let dy = -SM; dy <= SM; dy++) {
          let s = 0, n = 0;
          for (let r = r0; r < r1; r++) {
            const rp = r - dy;
            if (rp < 0 || rp >= PH) continue;
            const rc = r * PW, rpc = rp * PW;
            for (let c = 0; c < PW; c++) { s += Math.abs(cur[rc + c] - gray[rpc + c]); n++; }
          }
          if (n > 0) {
            s /= n;
            if (dy === 0) b0 = s;
            if (s < bsad) { bsad = s; bb = dy; }
          }
        }
        // the band's own shift must be clearly non-zero AND clearly better
        // than no-shift before it counts as evidence
        if (b0 < Infinity && bsad < b0 * 0.9 && Math.abs(bb) >= 2) {
          if (b === 0) { dyTop = bb; okTop = true; } else { dyBot = bb; okBot = true; }
        }
      }
      if (okTop && okBot && dyTop * dyBot < 0) camMotion = true;
      // A) zone grid — is the background still quiet anywhere?
      if (!camMotion) {
        const ZR = 3, ZC = 3, ZH = Math.floor(PH / ZR), ZW = Math.floor(PW / ZC);
        let quiet = 0;
        for (let zr = 0; zr < ZR; zr++) {
          for (let zc = 0; zc < ZC; zc++) {
            let ch = 0, tot = 0;
            const r0 = zr * ZH, r1 = (zr === ZR - 1) ? PH : r0 + ZH;
            const c0 = zc * ZW, c1 = (zc === ZC - 1) ? PW : c0 + ZW;
            for (let r = r0; r < r1; r++) {
              const row = r * PW;
              for (let c = c0; c < c1; c++) {
                if (Math.abs(cur[row + c] - gray[row + c]) > DIFF_T) ch++;
                tot++;
              }
            }
            if (tot > 0 && (ch / tot) < 0.12) quiet++;
          }
        }
        if (rawEnergy >= 0.40 && quiet <= 1) camMotion = true;
      }
    }
    gray.set(cur);
    if (camMotion) {
      // Camera moved — not body movement. Freeze ALL rep progress for this
      // frame (block-match path AND energy fallback) and report unchanged
      // state. A person exercising while the camera wobbles still counts:
      // their frames are not unanimously-aligned rigid translates.
      out.reps = this.reps; out.phase = this.phase; out.tempoSec = this.avgTempoSec();
      return out;
    }

    // confidence: the winning shift must clearly beat zero-shift
    const conf = sad0 > 0 ? (sad0 - bestSad) / sad0 : 0;
    const confident = conf > CONF_MIN && bestDy !== 0;
    if (confident) this._lastConfident = now;
    else if (!this.energyMode && this._lastConfident && now - this._lastConfident > 3000) {
      this.energyMode = true;   // no reliable shift for 3s → energy fallback
    }

    const REV = 2.4;              // reversal hysteresis (rows) ≈ 9 px real
    const gate = 3.5;             // min net travel (rows) per half-cycle ≈ 13 px
    const CONFIRM = 2.4;          // v7.1 ascent travel that PROVES a rep happened

    if (!this.energyMode) {
      // Phase-local travel accumulator: bestDy (per-frame velocity) is summed
      // ONLY within the current direction phase and reset at every reversal.
      // A rep = a DOWN phase whose net travel reached `gate`, followed by an
      // ascent that actually travels ≥ CONFIRM rows. The accumulator resets
      // at every flip → zero long-term drift (the naive position integrator
      // drifted ~10 rows/cycle from quantization bias and rode the ±clamp
      // within 2-3 cycles).
      // v7.1 ARM→COMMIT: at the bottom reversal the rep is only ARMED. It is
      // COMMITTED (counted) once the ascent shows real upward travel; a tiny
      // plateau bounce that never rises is discarded. This kills the classic
      // double-count at the top/bottom of slow reps (dwell + quantized dy
      // jitter used to look like a full extra cycle).
      this.dy = this.dy * 0.4 + bestDy * 0.6;      // smoothed velocity (HUD phase)
      if (confident) this.pos += bestDy;           // pos = net travel this phase
      if (this.dir === 0) {
        if (this.pos >= REV) { this.dir = 1; this.maxDy = this.pos; this.minDy = 0; }
        else if (this.pos <= -REV) { this.dir = -1; this.minDy = this.pos; this.maxDy = 0; }
      }
      if (this.dir === 1) {                        // descending phase (pos ≥ 0)
        if (this.pos > this.maxDy) this.maxDy = this.pos;
        this.phase = 'DOWN';
        if (this.pos < this.maxDy - REV) {         // reversed → body rising again
          const peak = this.maxDy;                 // net descent travel
          this._pending = (peak >= gate) ? { peak: peak, at: now } : null;
          this.dir = -1; this.minDy = this.pos; this.maxDy = 0; this.phase = 'UP';
          this.pos -= peak;                        // re-anchor: pos is PHASE-local
        }
      } else if (this.dir === -1) {                // ascending phase (pos ≤ 0)
        if (this.pos < this.minDy) this.minDy = this.pos;
        this.phase = 'UP';
        // commit the armed rep the moment the ascent proves itself
        if (this._pending && (-this.pos) >= CONFIRM && now - this.lastRepAt > 700) {
          this._countRep(now, this._pending.peak);
          this._pending = null;
        }
        if (this.pos > this.minDy + REV) {         // reversed → body descending
          const anchor = this.minDy;               // net ascent travel
          if (this._pending && (-anchor) < CONFIRM) this._pending = null; // ascent fizzled → discard
          this.dir = 1; this.minDy = 0; this.maxDy = this.pos; this.phase = 'DOWN';
          this.pos -= anchor;                      // re-anchor: pos is PHASE-local
        }
      }
    } else {
      // ── ENERGY fallback: every 2nd motion-power direction flip = 1 rep ──
      const dbE = Math.max(0.004, this.energy * 0.30);
      if (this._eDir === 0) { this._eDir = 1; this._eRef = this.energy; }
      if (this._eDir === 1) {
        if (this.energy > this._eRef) this._eRef = this.energy;
        if (this.energy < this._eRef - dbE) { this._eDir = -1; this._eRef = this.energy; this._eFlips++; }
      } else {
        if (this.energy < this._eRef) this._eRef = this.energy;
        if (this.energy > this._eRef + dbE) { this._eDir = 1; this._eRef = this.energy; this._eFlips++; }
      }
      const strong = this.energy > Math.max(this.base * 1.6, 0.012) || this._eRef > Math.max(this.base * 1.6, 0.012);
      if (this._eFlips >= 2 && strong && now - this.lastRepAt > 700) {
        this._eFlips = 0;
        this._countRep(now);
        this.phase = this.dy > 0 ? 'DOWN' : 'UP';
      }
    }

    out.reps = this.reps; out.phase = this.phase; out.tempoSec = this.avgTempoSec();
    return out;
  };

  MotionRepCounter.prototype.avgTempoSec = function () {
    if (!this.repIntervals.length) return 0;
    let s = 0; this.repIntervals.forEach(function (v) { s += v; });
    return Math.round((s / this.repIntervals.length) / 100) / 10;
  };

  /** Metrics summary for the local form checker. */
  MotionRepCounter.prototype.metrics = function () {
    let sway = 0;
    if (this._cxs.length > 20) {
      let mean = 0; this._cxs.forEach(function (v) { mean += v; }); mean /= this._cxs.length;
      let vari = 0; this._cxs.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= this._cxs.length;
      sway = Math.sqrt(vari) / PW;
    }
    let tempoCV = 0;
    if (this.repIntervals.length >= 3) {
      const arr = this.repIntervals;
      let mean = 0; arr.forEach(function (v) { mean += v; }); mean /= arr.length;
      let vari = 0; arr.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= arr.length;
      tempoCV = mean ? Math.sqrt(vari) / mean : 0;
    }
    // v7 — per-rep analytics: amplitude (range-of-motion) consistency and
    // left/right motion split, straight from the auto-counted rep log.
    let romCV = null, avgAmp = 0;
    const amps = (this.repLog || []).map(function (r) { return r.amp; }).filter(function (a) { return a > 0; });
    if (amps.length >= 3) {
      let mean = 0; amps.forEach(function (v) { mean += v; }); mean /= amps.length;
      let vari = 0; amps.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= amps.length;
      romCV = mean ? Math.sqrt(vari) / mean : 0;
      avgAmp = mean;
    }
    const symmetry = (this._symN > 12) ? Math.max(0, Math.min(1, 1 - Math.abs(this._sym - 0.5) * 2)) : null;
    return { sway: sway, tempoSec: this.avgTempoSec(), tempoCV: tempoCV, reps: this.reps, frames: this.frames,
             romCV: romCV, avgAmp: Math.round(avgAmp * 10) / 10, symmetry: symmetry, symShare: (this._symN > 12) ? this._sym : null };
  };

  // ══════════════════════════════════════════════════════════════════════
  // 2) LOCAL FORM CHECK — v7: MULTI-RESULT, per-exercise, data-driven
  // ══════════════════════════════════════════════════════════════════════
  // The verdict is built from what the camera ACTUALLY measured in THIS set
  // (auto-counted reps, tempo, range-of-motion consistency, left/right
  // balance, stability) and is matched to the SPECIFIC exercise pattern the
  // user is performing — different exercises get different targets, different
  // terminology and different fixes. The result carries SEVERAL findings
  // (results[]), each citing the user's real numbers — never one canned blob.
  const CUE_LIB = [
    { re: /(squat|lunge|step-?up|leg press|wall sit|thruster)/, issues: ['Knees may cave inward at the bottom', 'Heels can lift off the floor', 'Chest tends to drop forward'],
      cues: ['Push your knees OUT so they track over your toes', 'Keep your whole foot planted — drive through the floor', 'Chest up, eyes forward, brace your core before descending'] },
    { re: /(deadlift|hip thrust|bridge|good morning|hinge|swing)/, issues: ['Lower back can round under fatigue', 'Hips may rise before the chest', 'Weight can drift away from the body'],
      cues: ['Keep your back FLAT — hinge from the hips, not the waist', 'Chest and hips rise together', 'Keep the weight touching your legs the whole way'] },
    { re: /(bench|push-?up|chest press|chest dip|pec|fly)/, issues: ['Elbows often flare out to 90°', 'Hips can sag in push-up position', 'Range may shorten in the last reps'],
      cues: ['Keep elbows at about 45° to your torso', 'Squeeze glutes and brace — body stays one straight line', 'Lower all the way down with control, every rep'] },
    { re: /(pull-?up|chin-?up|row|lat pulldown|face pull)/, issues: ['Shoulders can shrug up to the ears', 'Momentum swings the body', 'Half reps at the top'],
      cues: ['Pull your shoulder blades DOWN and back first', 'Keep the body still — let the arms do the work', 'Pull until the bar reaches your upper chest'] },
    { re: /(shoulder press|overhead|pike push|lateral raise|front raise|rear delt)/, issues: ['Lower back can arch while pressing', 'Weights swing instead of lift', 'Shrugging the shoulders'],
      cues: ['Brace your core and keep ribs down — no arching', 'Lift with control, 2s up 2s down, no swinging', 'Keep shoulders away from your ears'] },
    { re: /(curl|tricep|extension|kickback|pushdown)/, issues: ['Elbows drift forward/back', 'Body sway turns it into a full-body move', 'Fast negatives skip half the rep'],
      cues: ['Pin your elbows to your sides — only the forearm moves', 'Stand tall, core tight — zero swinging', 'Take 2 seconds to lower the weight every rep'] },
    { re: /(plank|hold|crunch|sit-?up|leg raise|russian twist|hollow|core|abs)/, issues: ['Hips sag or pike up', 'Neck strains to lead the movement', 'Breath holding'],
      cues: ['Keep one straight line from head to heels — squeeze glutes', 'Look at the floor between your hands; let the abs do the work', 'Breathe steadily — never hold your breath'] },
    { re: /(jump|plyo|burpee|skater|bound|hop|clap)/, issues: ['Landing knees collapse inward', 'Reps get rushed and sloppy', 'Contact time on the floor grows'],
      cues: ['Land soft with knees tracking out — absorb through the hips', 'Reset your stance between every jump', 'Explode up, but never at the cost of the landing'] }
  ];
  const GENERIC = { issues: ['Tempo can get rushed under fatigue', 'Range of motion may shorten', 'Posture can drift from the start position'],
    cues: ['Control every rep — 2s down, strong drive up', 'Move through your full, pain-free range', 'Re-set your posture before each rep'] };

  // Exercise-pattern profiles: ideal tempo window + what "range of motion"
  // means for THIS movement + its technique focus. The form verdict quotes
  // these per-exercise targets, so a Squat read-out ≠ a Push-up read-out.
  const FORM_PROFILES = [
    { re: /(squat|lunge|step-?up|leg press|wall sit|thruster|split squat)/,
      type: { en: 'squat / lunge pattern', ar: 'نمط السكوات / الاندفاع' }, tempo: [1.6, 4.5],
      rom: { en: 'depth consistency', ar: 'ثبات عمق النزول' },
      focus: { en: 'Knees tracking over toes · chest up · full depth every rep', ar: 'الركبتان فوق أصابع القدم · الصدر مرفوع · عمق كامل في كل تكرار' } },
    { re: /(deadlift|hip thrust|bridge|good morning|hinge|swing)/,
      type: { en: 'hip-hinge pattern', ar: 'نمط مفصل الورك' }, tempo: [1.8, 5.0],
      rom: { en: 'hinge range consistency', ar: 'ثبات مدى الحركة' },
      focus: { en: 'Flat back · hips and chest rise together · weight close to you', ar: 'الظهر مستقيم · الورك والصدر يرتفعان معاً · الوزن قريب منك' } },
    { re: /(bench|push-?up|chest press|chest dip|pec|fly)/,
      type: { en: 'pressing pattern', ar: 'نمط الدفع' }, tempo: [1.5, 4.0],
      rom: { en: 'depth / lockout consistency', ar: 'ثبات العمق والمدى' },
      focus: { en: 'Elbows ~45° · body one straight line · full depth to lockout', ar: 'المرفقان بزاوية ٤٥° · الجسم خط مستقيم · مدى كامل' } },
    { re: /(pull-?up|chin-?up|row|lat pulldown|face pull)/,
      type: { en: 'pulling pattern', ar: 'نمط السحب' }, tempo: [1.8, 5.0],
      rom: { en: 'pull range consistency', ar: 'ثبات مدى السحب' },
      focus: { en: 'Shoulder blades down first · body still · pull to full contact', ar: 'اسحب لوحي الكتف أولاً · الجسم ثابت · سحب حتى التلامس الكامل' } },
    { re: /(shoulder press|overhead|pike push|lateral raise|front raise|rear delt)/,
      type: { en: 'overhead press pattern', ar: 'نمط الدفع العلوي' }, tempo: [1.5, 3.5],
      rom: { en: 'press range consistency', ar: 'ثبات مدى الدفع' },
      focus: { en: 'Ribs down · no swinging · shoulders away from the ears', ar: 'الأضلاع للأسفل · بلا تأرجح · الأكتاف بعيدة عن الأذنين' } },
    { re: /(curl|tricep|extension|kickback|pushdown)/,
      type: { en: 'isolation arm pattern', ar: 'نمط عزل الذراع' }, tempo: [1.4, 3.5],
      rom: { en: 'elbow range consistency', ar: 'ثبات مدى المرفق' },
      focus: { en: 'Elbows pinned · zero body swing · slow lowering', ar: 'المرفقان ثابتان · بدون تأرجح · إنزال بطيء' } },
    { re: /(plank|hold|crunch|sit-?up|leg raise|russian twist|hollow|core|abs)/,
      type: { en: 'core pattern', ar: 'نمط عضلات البطن' }, tempo: [1.5, 4.0],
      rom: { en: 'movement control', ar: 'التحكم بالحركة' },
      focus: { en: 'Head-to-heels line · let the abs work · steady breathing', ar: 'خط من الرأس للكعب · عضلات البطن تعمل · تنفس منتظم' } },
    { re: /(jump|plyo|burpee|skater|bound|hop|clap)/,
      type: { en: 'explosive / plyometric pattern', ar: 'نمط الانفجاري/البليومتري' }, tempo: [0.8, 2.6],
      rom: { en: 'jump height consistency', ar: 'ثبات ارتفاع القفز' },
      focus: { en: 'Land soft · knees out on landing · reset between reps', ar: 'اهبط بنعومة · الركبتان للخارج عند الهبوط · اضبط وقفتك بين التكرارات' } }
  ];
  const FORM_GENERIC_PROFILE = {
    type: { en: 'movement pattern', ar: 'نمط الحركة' }, tempo: [1.5, 4.0],
    rom: { en: 'range-of-motion consistency', ar: 'ثبات مدى الحركة' },
    focus: { en: 'Full range · controlled tempo · same setup every rep', ar: 'مدى كامل · إيقاع متحكم به · نفس الوقفة كل تكرار' }
  };

  /**
   * v7 local form verdict — MULTI-RESULT and exercise-specific.
   *   m:    { sway(0..1), tempoSec, tempoCV, reps, frames, romCV, avgAmp,
   *           symmetry(0..1|null), symShare(0..1|null), durationSec }
   *   opts: { lang: 'en'|'ar', durationSec }
   * Returns { verdict, score, measured, results[4-6], issues, cues, safety… }
   */
  function formCheckLocal(exercise, m, opts) {
    m = m || {}; opts = opts || {};
    const lang = (opts.lang === 'ar') ? 'ar' : 'en';
    const L = function (en, ar) { return lang === 'ar' ? ar : en; };
    const exName = String(exercise || 'exercise');
    const lower = exName.toLowerCase();
    const cue = CUE_LIB.find(function (c) { return c.re.test(lower); }) || GENERIC;
    const prof = FORM_PROFILES.find(function (p) { return p.re.test(lower); }) || FORM_GENERIC_PROFILE;
    const typeLabel = prof.type[lang];
    const tMin = prof.tempo[0], tMax = prof.tempo[1];
    const durationSec = Math.max(0, Math.round(Number(m.durationSec != null ? m.durationSec : (opts.durationSec || 0)) || 0));
    const safety = L('Stop the set immediately if you feel sharp pain, dizziness or numbness. Quality reps only — never trade form for extra reps.',
                     'أوقف المجموعة فوراً إذا شعرت بألم حاد أو دوار أو تنميل. التكرارات النظيفة فقط — لا تضحِّ بالأداء أبداً مقابل تكرار إضافي.');
    const exTypeLabel = L('Exercise', 'التمرين');

    // ── no measured reps yet → honest "nothing to analyze yet" result ──
    if (!(m.reps > 0) || !(m.tempoSec > 0)) {
      return {
        ok: true, onDevice: true, noData: true, exercise: exName, exerciseType: typeLabel,
        verdict: 'okay', score: 60,
        measured: { reps: 0, durationSec: durationSec },
        results: [{ icon: 'fa-video-slash', verdict: 'warn',
          title: L('No movement measured yet', 'لم تُقَس أي حركة بعد'),
          text: L('Step back so your FULL body is in frame, then perform slow, controlled reps — the AI form check reads your actual movement of ' + exName + ', so it needs real reps to judge.',
                  'ابتعد قليلاً ليظهر جسمك كاملاً في الإطار ثم أدِّ تكرارات بطيئة ومتحكم بها — فحص الأداء بالذكاء الاصطناعي يقرأ حركتك الفعلية في ' + exName + '، لذا يحتاج تكرارات حقيقية ليحكم.') }],
        issues: [], cues: cue.cues.slice(0, 2),
        safety: safety, safetyLevel: 'medium'
      };
    }

    // ── measured stats (rounded for display) ──
    const reps = m.reps;
    const tempo = m.tempoSec;
    const tempoCV = (m.tempoCV != null) ? m.tempoCV : 0;
    const romCV = (m.romCV != null && m.romCV > 0) ? m.romCV : null;
    const symmetry = (m.symmetry != null) ? m.symmetry : null;
    const symShare = (m.symShare != null) ? m.symShare : null;
    const sway = (m.sway != null) ? m.sway : 0;
    const tempoPct = Math.max(0, Math.min(100, Math.round((1 - Math.min(tempoCV, 1)) * 100)));
    const romPct = (romCV != null) ? Math.max(0, Math.min(100, Math.round((1 - Math.min(romCV, 1)) * 100))) : null;
    const symPct = (symmetry != null) ? Math.round(symmetry * 100) : null;
    const stabPct = Math.max(0, Math.min(100, Math.round((1 - Math.min(sway * 2.4, 1)) * 100)));
    const lPct = (symShare != null) ? Math.round(symShare * 100) : null;
    const rPct = (lPct != null) ? (100 - lPct) : null;

    const results = [];
    let score = 82;
    const issues = [], cues = [];

    // 1) Rep rhythm vs THIS exercise's ideal tempo window
    const inRange = tempo >= tMin && tempo <= tMax;
    if (inRange) {
      score += 4;
      results.push({ icon: 'fa-stopwatch', verdict: 'good', title: L('Rep rhythm — right on target', 'إيقاع التكرارات — في الهدف تماماً'),
        text: L('AI auto-counted ' + reps + ' reps at ~' + tempo + 's each — inside the ideal ' + tMin + '–' + tMax + 's window for the ' + typeLabel + '.',
                'عدّ الذكاء الاصطناعي ' + reps + ' تكراراً بمعدل ~' + tempo + ' ث لكل تكرار — ضمن النطاق المثالي ' + tMin + '–' + tMax + ' ث لـ' + typeLabel + '.') });
    } else if (tempo < tMin) {
      score -= 8;
      issues.push(L('Reps are faster than the ideal ' + tMin + '–' + tMax + 's window — momentum is helping', 'التكرارات أسرع من النطاق المثالي ' + tMin + '–' + tMax + ' ث — الزخم يساعدك'));
      results.push({ icon: 'fa-stopwatch', verdict: 'warn', title: L('Rep rhythm — too fast', 'إيقاع التكرارات — سريع جداً'),
        text: L('AI counted ' + reps + ' reps at ~' + tempo + 's each; the ' + typeLabel + ' wants ' + tMin + '–' + tMax + 's. Slow the lowering phase down.',
                'عدّ الذكاء الاصطناعي ' + reps + ' تكراراً بمعدل ~' + tempo + ' ث؛ و' + typeLabel + ' يحتاج ' + tMin + '–' + tMax + ' ث. أبطئ مرحلة النزول.') });
      cues.push(L('Control every rep — ' + (tMin < 1.5 ? 'explode up' : '2s down') + ', then drive up.', 'تحكم بكل تكرار — ' + (tMin < 1.5 ? 'انفجر صعوداً' : ' ثانيتين نزولاً') + ' ثم ادفع بقوة.'));
    } else {
      score -= 5;
      results.push({ icon: 'fa-stopwatch', verdict: 'warn', title: L('Rep rhythm — slower than target', 'إيقاع التكرارات — أبطأ من الهدف'),
        text: L('Reps averaged ' + tempo + 's vs the ideal ' + tMin + '–' + tMax + 's for the ' + typeLabel + ' — fine for heavy grinding, but stay explosive where you can.',
                'متوسط التكرار ' + tempo + ' ث مقابل المثالي ' + tMin + '–' + tMax + ' ث لـ' + typeLabel + ' — مقبول مع الأوزان الثقيلة، لكن حافظ على الانفجار حيث تستطيع.') });
    }

    // 2) Consistency of the rep timing
    if (tempoCV <= 0.25) {
      score += 4;
      results.push({ icon: 'fa-wave-square', verdict: 'good', title: L('Pacing consistency', 'ثبات الإيقاع'),
        text: L('Rep timing varied only ' + (100 - tempoPct) + '% — very even pacing across all ' + reps + ' reps (' + tempoPct + '% consistent).',
                'تباين توقيت التكرارات ' + (100 - tempoPct) + '% فقط — إيقاع متجانس عبر ' + reps + ' تكرارات (ثبات ' + tempoPct + '%).') });
    } else if (tempoCV <= 0.38) {
      results.push({ icon: 'fa-wave-square', verdict: 'warn', title: L('Pacing consistency', 'ثبات الإيقاع'),
        text: L('Rep timing varied ' + (100 - tempoPct) + '% (' + tempoPct + '% consistent) — steady enough, keep this rhythm.',
                 'تباين توقيت التكرارات ' + (100 - tempoPct) + '% (ثبات ' + tempoPct + '%) — ثابت بما يكفي، حافظ على هذا الإيقاع.') });
    } else {
      score -= 10;
      issues.push(L('Rep timing is uneven — some reps rush while others crawl', 'توقيت التكرارات غير متساوٍ — بعض التكرارات متسارعة وبعضها بطيء'));
      results.push({ icon: 'fa-wave-square', verdict: 'bad', title: L('Pacing consistency', 'ثبات الإيقاع'),
        text: L('Your rep timing swung ' + (100 - tempoPct) + '% (' + tempoPct + '% consistent) — usually the sign of fatigue or lost focus at rep ' + Math.max(1, Math.round(reps * 0.7)) + '.',
                 'تأرجح توقيت التكرارات ' + (100 - tempoPct) + '% (ثبات ' + tempoPct + '%) — غالباً علامة تعب أو فقدان تركيز عند التكرار ' + Math.max(1, Math.round(reps * 0.7)) + '.') });
      cues.push(cue.cues[0]);
    }

    // 3) Range of motion (per-rep amplitude consistency) — the metric MEANS
    //    something different per exercise (depth / hinge range / lockout…).
    if (romPct != null) {
      const romLabel = prof.rom[lang];
      if (romPct >= 78) {
        score += 4;
        results.push({ icon: 'fa-arrows-up-down', verdict: 'good', title: L('Range of motion — ' + romLabel, 'مدى الحركة — ' + romLabel),
          text: L(romLabel + ' stayed at ' + romPct + '% across your reps — your first rep and last rep look the same. Excellent repeatability.',
                  romLabel + ' عند ' + romPct + '% عبر تكراراتك — أول تكرار وآخره متشابهان. تكرارية ممتازة.') });
      } else if (romPct >= 60) {
        results.push({ icon: 'fa-arrows-up-down', verdict: 'warn', title: L('Range of motion — ' + romLabel, 'مدى الحركة — ' + romLabel),
          text: L(romLabel + ' measured ' + romPct + '% — the last reps probably shortened a little. Keep the same depth every rep.',
                  romLabel + ' عند ' + romPct + '% — على الأرجح قصرت آخر التكرارات قليلاً. حافظ على نفس العمق كل تكرار.') });
        cues.push(cue.cues[2] || GENERIC.cues[1]);
      } else {
        score -= 9;
        issues.push(L(romLabel + ' dropped to ' + romPct + '% — early and late reps differ a lot', romLabel + ' هبط إلى ' + romPct + '% — الفرق كبير بين بداية المجموعة ونهايتها'));
        results.push({ icon: 'fa-arrows-up-down', verdict: 'bad', title: L('Range of motion — ' + romLabel, 'مدى الحركة — ' + romLabel),
          text: L(romLabel + ' only ' + romPct + '% — big difference between your first and last reps. Stop the set when the range starts shrinking; that is the real "failure" point.',
                  romLabel + ' عند ' + romPct + '% فقط — فرق كبير بين أول وآخر تكرار. أوقف المجموعة عندما يبدأ المدى بالتقلص؛ هذه هي نقطة "الفشل" الحقيقية.') });
        cues.push(cue.cues[2] || GENERIC.cues[1]);
      }
    }

    // 4) Left/right balance (from the motion-energy split over the set)
    if (symPct != null && reps >= 3) {
      if (symPct >= 85) {
        score += 3;
        results.push({ icon: 'fa-scale-balanced', verdict: 'good', title: L('Left / right balance', 'توازن اليسار/اليمين'),
          text: L('Motion split ' + lPct + '% / ' + rPct + '% between the two sides of the frame — nicely balanced for the ' + typeLabel + '.',
                  'توزيع الحركة ' + lPct + '% / ' + rPct + '% بين جانبي الإطار — توازن جميل لـ' + typeLabel + '.') });
      } else if (symPct >= 72) {
        results.push({ icon: 'fa-scale-balanced', verdict: 'warn', title: L('Left / right balance', 'توازن اليسار/اليمين'),
          text: L('Motion leans ' + lPct + '% / ' + rPct + '% — one side is working a bit harder. Even it out before it becomes a habit.',
                  'الحركة تميل ' + lPct + '% / ' + rPct + '% — أحد الجانبين يعمل أكثر قليلاً. وازنه قبل أن يتحول لعادة.') });
      } else {
        score -= 8;
        issues.push(L('Strong side-to-side imbalance: ' + lPct + '% vs ' + rPct + '% of the movement', 'اختلال واضح بين الجانبين: ' + lPct + '% مقابل ' + rPct + '% من الحركة'));
        results.push({ icon: 'fa-scale-balanced', verdict: 'bad', title: L('Left / right balance', 'توازن اليسار/اليمين'),
          text: L('One side carried ' + Math.max(lPct, rPct) + '% of the movement (' + lPct + '% / ' + rPct + '%). Center yourself in frame and share the work evenly.',
                  'أحد الجانبين حمل ' + Math.max(lPct, rPct) + '% من الحركة (' + lPct + '% / ' + rPct + '%). تمركز في الإطار ووزّع العمل بالتساوي.') });
        cues.push(cue.cues[1] || GENERIC.cues[2]);
      }
    }

    // 5) Stability between reps (body drift / camera-frame wandering)
    if (stabPct >= 80) {
      score += 3;
      results.push({ icon: 'fa-person-falling', verdict: 'good', title: L('Stability & setup', 'الثبات والوقفة'),
        text: L('Body stayed planted (' + stabPct + '% stable) — minimal drifting between reps.',
                 'بقيت ثابتاً (استقرار ' + stabPct + '%) — انحراف ضئيل بين التكرارات.') });
    } else if (stabPct >= 62) {
      results.push({ icon: 'fa-person-falling', verdict: 'warn', title: L('Stability & setup', 'الثبات والوقفة'),
        text: L('Some drifting between reps (' + stabPct + '% stable) — brace your core and re-set your stance.',
                 'بعض الانحراف بين التكرارات (استقرار ' + stabPct + '%) — شدّ عضلات جذعك وأعد ضبط وقفتك.') });
    } else {
      score -= 8;
      issues.push(L('Body drifts around between reps — the working position is not fixed', 'الجسم يتحرك بين التكرارات — وضعية الأداء غير ثابتة'));
      results.push({ icon: 'fa-person-falling', verdict: 'bad', title: L('Stability & setup', 'الثبات والوقفة'),
        text: L('You moved around a lot between reps (' + stabPct + '% stable). Fix your setup before each rep — drifting form is how joints get grumpy.',
                 'تحركت كثيراً بين التكرارات (استقرار ' + stabPct + '%). اضبط وقفتك قبل كل تكرار — الأداء المتنقل هو ما يزعج المفاصل.') });
      cues.push(cue.cues[1] || GENERIC.cues[2]);
    }

    // 6) The exercise's own technique focus (always present, varies per pattern)
    results.push({ icon: 'fa-bullseye', verdict: inRange && tempoPct >= 70 ? 'good' : 'warn',
      title: L('Technique focus — ' + exName, 'تركيز الأداء — ' + exName),
      text: (prof.focus[lang] + ' ' + L('(' + exTypeLabel + ': ' + exName + ')', '(التمرين: ' + exName + ')')).trim() });

    score = Math.max(42, Math.min(97, Math.round(score)));
    if (!issues.length) issues.push(L('No technical breakdown detected in this set — the findings above still apply.', 'لا يوجد انهيار تقني في هذه المجموعة — الملاحظات أعلاه ما زالت تنطبق.'));
    if (!cues.length) cues.push(prof.focus[lang]);
    return {
      ok: true, onDevice: true, exercise: exName, exerciseType: typeLabel,
      verdict: score >= 80 ? 'good' : score >= 62 ? 'okay' : 'bad',
      score: score,
      measured: { reps: reps, tempoSec: tempo, tempoConsistencyPct: tempoPct, romConsistencyPct: romPct,
                  symmetryPct: symPct, leftPct: lPct, rightPct: rPct, stabilityPct: stabPct, durationSec: durationSec },
      results: results.slice(0, 6),
      issues: issues.slice(0, 3), cues: cues.slice(0, 3),
      safety: safety, safetyLevel: score >= 80 ? 'low' : score >= 62 ? 'medium' : 'high'
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3) LOCAL PROGRESSION — the server's ≤10% safety rule, offline
  // ══════════════════════════════════════════════════════════════════════
  function muscleOf(exercise) {
    const n = String(exercise || '').toLowerCase();
    if (/(bench|chest|pec|push-?up|fly|dip)/.test(n)) return 'Chest';
    if (/(row|pull-?up|pullup|lat pulldown|\blats?\b|pullover|back|face pull|shrug)/.test(n)) return 'Back';
    if (/(squat|lunge|leg|calf|quad|hamstring|glute|hip thrust|step)/.test(n)) return 'Legs';
    if (/(shoulder|press|overhead|pike|raise|delt)/.test(n)) return 'Shoulders';
    if (/(curl|tricep|extension|kickback|forearm|wrist)/.test(n)) return 'Arms';
    if (/(plank|crunch|core|abs|twist|hollow|sit-?up)/.test(n)) return 'Core';
    return 'Full Body';
  }
  const WARMUPS = {
    Chest: '1 light set of 15 push-ups or band pull-aparts, then 50% of your working weight × 8.',
    Back: '1 light set of band rows or 10 banded pull-ups, then 50% × 8.',
    Legs: '2 minutes of bodyweight squats + leg swings, then 50% of your working weight × 8.',
    Shoulders: '10 arm circles each way + 1 light set of presses at 50% × 10.',
    Arms: '1 very light warm-up set of 15 reps before your working weight.',
    Core: '30 seconds of dead bugs + 10 slow crunches before the working sets.',
    'Full Body': '3-5 minutes of light cardio + 1 light technique set at 50% × 8.'
  };
  const SAFETIES = {
    Chest: 'Keep wrists stacked over elbows and stop 1-2 reps before failure.',
    Back: 'Never round your lower back — if form breaks, the weight is too heavy.',
    Legs: 'Keep knees tracking over toes; depth before load, always.',
    Shoulders: 'If your lower back arches, reduce the weight — ribs down, core braced.',
    Arms: 'Strict reps only — swinging means the weight went up too fast.',
    Core: 'Quality over quantity — stop when your form stutters, not when it collapses.',
    'Full Body': 'Progress one variable at a time: weight OR reps, never both at once.'
  };
  /** lastLogs: [{sets,reps,weight}] · bodyWeight: kg|null */
  function progressionLocal(exercise, lastLogs, bodyWeight) {
    const lib = (lastLogs || []).filter(function (l) { return l && ((l.weight > 0) || (l.reps > 0)); });
    const muscle = muscleOf(exercise);
    if (!lib.length) {
      const starter = muscle === 'Legs' ? 'an empty barbell or bodyweight' : (bodyWeight ? 'your bodyweight' : 'a light weight you could lift 12+ times');
      return {
        ok: true, onDevice: true, exercise: exercise, progression: 'new',
        suggestion: { sets: 3, reps: 8, weight: 0, restSec: 90, rpe: 7 },
        reason: 'No history for ' + exercise + ' yet, so Volta starts you conservatively with ' + starter + '. Log this session and ProgressIQ will prescribe exact numbers next time.',
        warmup: WARMUPS[muscle], safety: SAFETIES[muscle]
      };
    }
    const best = lib.reduce(function (a, b) { return ((b.weight || 0) > (a.weight || 0) ? b : a); });
    const w = best.weight || 0, r = best.reps || 8;
    let suggestion, progression, reason;
    if (w > 0) {
      const cap = w * 1.10;                                   // hard ≤10% cap
      let next = (r >= 8) ? Math.min(cap, w + (w < 20 ? 1 : 2.5)) : w;
      next = Math.round(next * 2) / 2;                        // nearest 0.5 kg
      progression = next > w ? 'increase' : 'hold';
      suggestion = { sets: 3, reps: r >= 8 ? 8 : Math.min(12, r + 1), weight: next, restSec: 90, rpe: r >= 8 ? 8 : 7 };
      reason = progression === 'increase'
        ? 'You hit ' + r + ' reps at ' + w + ' kg — that earns a small jump to ' + next + ' kg (+' + Math.round((next / w - 1) * 100) + '%, safely under the 10% cap).'
        : 'Stay at ' + w + ' kg until you comfortably hit 8 clean reps — you managed ' + r + ' last time.';
    } else {
      progression = r >= 12 ? 'increase' : 'hold';
      suggestion = { sets: 3, reps: 10, weight: 0, restSec: 75, rpe: 7 };
      reason = progression === 'increase'
        ? 'Bodyweight ' + exercise + ' is getting easy (' + r + ' reps). This session add load or a harder variation; otherwise build to 15 reps.'
        : 'Keep mastering the bodyweight version — ' + r + ' solid reps per set. Build to 12+ before adding load.';
    }
    return { ok: true, onDevice: true, exercise: exercise, progression: progression, suggestion: suggestion, reason: reason, warmup: WARMUPS[muscle], safety: SAFETIES[muscle] };
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4) LOCAL RECOVERY — condition-aware, MULTI-ANSWER recovery engine
  // ══════════════════════════════════════════════════════════════════════
  // Fully offline. Reads EVERYTHING the user reports about their condition
  // and answers SEVERAL questions at once (not one canned blob):
  //   • inputs: { soreness: none|mild|moderate|severe,
  //               sleepH: number|null, energy: 1-5|null,
  //               soreArea: ''|Chest|Back|Legs|Shoulders|Arms|Core|Full Body }
  //   • opts:   { injury: 'None'|'Knees'|'Lower back'|'Shoulders', lang }
  //   • weekLogs: [{date, muscleGroups[], minutes}] — the last 7 days
  // Returns: overall, verdict, summary, muscles[6] (varied advice),
  // answers[] (multiple direct answers), actions[] (recovery steps),
  // todayFocus, avoid[], injuryNote, tip, weeklyLoadMin.
  function recoveryLocal(weekLogs, inputs, opts) {
    inputs = inputs || {};
    opts = opts || {};
    const lang = (opts.lang === 'ar') ? 'ar' : 'en';
    const L = function (en, ar) { return lang === 'ar' ? ar : en; };
    const GROUPS_EN = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
    const GROUPS_AR = { 'Chest': 'الصدر', 'Back': 'الظهر', 'Legs': 'الأرجل', 'Shoulders': 'الأكتاف', 'Arms': 'الذراعين', 'Core': 'البطن', 'Full Body': 'كل الجسم' };
    const gname = function (g) { return lang === 'ar' ? (GROUPS_AR[g] || g) : g; };

    // ── 1) 48h fatigue-decay model over the week's sessions ──
    const now = Date.now();
    const fatigue = {}; GROUPS_EN.forEach(function (g) { fatigue[g] = 0; });
    let totalLoad = 0, sessionsCount = 0, lastTrainedDay = '';
    (weekLogs || []).forEach(function (s) {
      const d = new Date((s.date || '') + 'T12:00:00');
      if (isNaN(d)) return;
      const hours = Math.max(0, (now - d.getTime()) / 36e5);
      if (hours > 24 * 8) return;
      const decay = Math.exp(-hours / 42);              // ~42h recovery constant
      const mins = Math.max(5, Math.min(180, Number(s.minutes) || 30));
      const load = mins * 0.55 * decay;
      const groups = (s.muscleGroups && s.muscleGroups.length) ? s.muscleGroups : ['Full Body'];
      groups.forEach(function (gRaw) {
        if (GROUPS_EN.indexOf(gRaw) >= 0) fatigue[gRaw] += load;
        else GROUPS_EN.forEach(function (g2) { fatigue[g2] += load * 0.45; });  // full-body spreads
      });
      totalLoad += mins;
      sessionsCount++;
      lastTrainedDay = s.date || lastTrainedDay;
    });

    // ── 2) The user's reported condition ──
    const soreness = ['none', 'mild', 'moderate', 'severe'].indexOf(inputs.soreness) >= 0 ? inputs.soreness : 'none';
    const sleepH = (inputs.sleepH != null && isFinite(inputs.sleepH) && inputs.sleepH > 0) ? Number(inputs.sleepH) : null;
    const energy = (inputs.energy != null && isFinite(inputs.energy)) ? Math.max(1, Math.min(5, Number(inputs.energy))) : 3;
    const soreArea = (typeof inputs.soreArea === 'string' && GROUPS_EN.indexOf(inputs.soreArea) >= 0) ? inputs.soreArea :
                     (inputs.soreArea === 'Full Body' ? 'Full Body' : '');
    const injury = (typeof opts.injury === 'string' && opts.injury && opts.injury !== 'None') ? opts.injury : '';
    // Injury → affected muscle groups (advised around, never trained hard)
    const injuryGroups = injury === 'Knees' ? ['Legs'] :
                         injury === 'Lower back' ? ['Back', 'Core'] :
                         injury === 'Shoulders' ? ['Shoulders'] : [];

    const sorenessPen = { none: 0, mild: 6, moderate: 14, severe: 26 }[soreness] || 0;
    const sleepPen = (sleepH != null) ? (sleepH < 5 ? 12 : sleepH < 6.5 ? 7 : sleepH < 7.5 ? 3 : 0) : 0;
    const energyPen = Math.max(0, (3 - energy)) * 4;
    const otherPen = sorenessPen * 0.55 + sleepPen * 0.5 + energyPen * 0.5;

    // Localized extra fatigue from the reported sore area
    if (soreArea === 'Full Body') GROUPS_EN.forEach(function (g) { fatigue[g] += 10; });
    else if (soreArea) fatigue[soreArea] += 14;
    // Soreness levels also weight the reported area harder
    if (soreArea && soreness === 'severe') fatigue[soreArea] += 10;
    else if (soreArea && soreness === 'moderate') fatigue[soreArea] += 5;

    // ── 3) Per-muscle readiness with VARIED, condition-specific advice ──
    const advicePools = {
      recovered: [
        L('Fully recovered — this group is primed for your hardest work today.', 'مستشفى تماماً — هذه المجموعة جاهزة لأقوى تدريب اليوم.'),
        L('Fresh and ready — push the intensity here with confidence.', 'منتعشة وجاهزة — ارفع الشدة هنا بثقة.'),
        L('Top shape — ideal day to set a personal best on this group.', 'في أفضل حالاتها — يوم مثالي لتحقيق رقم شخصي على هذه المجموعة.')
      ],
      fresh: [
        L('Nearly recovered — great for quality sets or a lighter session.', 'شبه مستشفية — مناسبة لمجموعات عالية الجودة أو جلسة أخف.'),
        L('Good to go — start moderate and build up if it feels strong.', 'جاهزة للعمل — ابدأ باعتدال وارتفع إن شعرت بقوة.'),
        L('Ready with a small reserve — keep 1-2 reps in the tank on heavy sets.', 'جاهزة مع احتياط بسيط — أبقِ ١-٢ تكرار احتياطياً في المجموعات الثقيلة.')
      ],
      fatigued: [
        L('Still recovering — train it only if you feel 100%, otherwise go easy.', 'ما زالت تستشفي — درّبها فقط إذا كنت بكامل طاقتك، وإلا اجعلها خفيفة.'),
        L('Carrying fatigue — reduce the load ~20% or pick easier variations.', 'تحمل تعباً — قلّل الحمل نحو ٢٠٪ أو اختر تنويعات أسهل.'),
        L('Half-recovered — light pump work is fine, skip max efforts here.', 'مستشفية جزئياً — العمل الخفيف مناسب، وتجنب أقصى الجهد هنا.')
      ],
      overworked: [
        L('Deeply fatigued — let it rest; hitting it again today risks injury.', 'متعبة جداً — اتركها ترتاح؛ تدريبها اليوم يعرضك للإصابة.'),
        L('This group needs another day or two — train around it, not on it.', 'تحتاج يوماً أو يومين إضافيين — درّب ما حولها لا هي نفسها.'),
        L('Overworked — mobility and light stretching only, no loading today.', 'مجهدة — مرونة وتمدد خفيف فقط، دون أوزان اليوم.')
      ]
    };
    let adviceIdx = 0;
    const muscles = GROUPS_EN.map(function (g) {
      const f = fatigue[g];
      const score = Math.max(5, Math.min(100, Math.round(100 - f * 1.35 - otherPen)));
      const status = score >= 85 ? 'recovered' : score >= 65 ? 'fresh' : score >= 40 ? 'fatigued' : 'overworked';
      const statusLocal = { recovered: L('Recovered', 'مستشفية'), fresh: L('Fresh', 'منتعشة'), fatigued: L('Fatigued', 'متعبة'), overworked: L('Overworked', 'مجهدة جداً') }[status];
      const need = Math.max(0.5, 100 - 72 - otherPen);
      let readyIn = (f * 1.35 > need) ? Math.ceil(42 * Math.log((f * 1.35) / need)) : 0;
      readyIn = Math.max(0, Math.min(96, readyIn));
      // Vary the advice across cards (rotating pool) + condition modifiers
      let advice = advicePools[status][adviceIdx++ % 3];
      if (soreArea === g) {
        advice += ' ' + (lang === 'ar'
          ? 'هذه هي المنطقة التي حددتها كمتعبـة — أعطها أولوية في الراحة اليوم.'
          : 'This is the area you marked as sore — give it rest priority today.');
      }
      if (injuryGroups.indexOf(g) >= 0) {
        advice += ' ' + (lang === 'ar'
          ? 'ملحوظة إصابتك (' + injury + ') تشمل هذه المنطقة — تجنب الحركات المؤلمة وثبّت الأوزان الخفيفة.'
          : 'Your injury note (' + injury + ') covers this area — avoid painful ranges and keep loads conservative.');
      }
      return { group: gname(g), groupEn: g, score: score, status: status, statusLocal: statusLocal, advice: advice, readyIn: readyIn, fatigue: Math.round(f * 10) / 10 };
    });

    const overall = Math.round(muscles.reduce(function (a, m) { return a + m.score; }, 0) / muscles.length);
    const ready = muscles.filter(function (m) { return m.score >= 72; }).sort(function (a, b) { return b.score - a.score; });
    const avoid = muscles.filter(function (m) { return m.score < 45; }).map(function (m) { return m.group; });

    // ── 4) VERDICT + summary (responds to the whole condition) ──
    const verdictMap = {
      high: L('Well recovered', 'استشفاء جيد'),
      mid:  L('Partially recovered', 'استشفاء جزئي'),
      low:  L('Needs rest', 'تحتاج للراحة')
    };
    const verdict = overall >= 75 ? verdictMap.high : overall >= 55 ? verdictMap.mid : verdictMap.low;
    let summary;
    if (soreness === 'severe') {
      summary = lang === 'ar'
        ? 'أبلغت عن تعب عضلي شديد — خفّض شدة اليوم وركّز على الحركة الخفيفة والمرونة.'
        : 'You reported severe soreness — dial today\'s intensity down and focus on light movement and mobility.';
    } else if (sleepH != null && sleepH < 6) {
      summary = lang === 'ar'
        ? 'نومك الليلة الماضية (' + sleepH + ' س) قصير — قلّل الأحمال الثقيلة ومدّد فترات الراحة.'
        : 'Your sleep last night (' + sleepH + 'h) was short — reduce heavy loads and extend rest periods.';
    } else if (energy <= 2) {
      summary = lang === 'ar'
        ? 'طاقتك منخفضة اليوم — جلسة أخف أو استشفاء نشط (مشي + مرونة) هي الخيار الأذكى.'
        : 'Your energy is low today — a lighter session or active recovery (walk + mobility) is the smarter call.';
    } else if (totalLoad === 0) {
      summary = lang === 'ar'
        ? 'لا جلسات مسجلة هذا الأسبوع — جسمك منتعش، فابدأ بأول تمرين وخطة متدرجة.'
        : 'No sessions logged this week — your body is fresh; start your first session and build up gradually.';
    } else if (overall >= 75) {
      summary = lang === 'ar'
        ? 'استشفاؤك ممتاز (' + sessionsCount + ' جلسات هذا الأسبوع) — جسمك جاهز لتحدي اليوم.'
        : 'Your recovery is excellent (' + sessionsCount + ' sessions this week) — your body is ready for a challenge.';
    } else {
      summary = lang === 'ar'
        ? 'بعد ' + sessionsCount + ' جلسات هذا الأسبوع، جسمك في منتصف الطريق للاستشفاء — اختر المجموعات الجاهزة فقط.'
        : 'After ' + sessionsCount + ' sessions this week, your body is mid-recovery — train only the ready groups.';
    }

    // ── 5) MULTIPLE ANSWERS (the "only gives 1 answer" fix) ──
    const answers = [];
    // Q: What should I train today?
    answers.push({
      icon: 'fa-dumbbell',
      title: L('What should I train today?', 'ماذا أدرّب اليوم؟'),
      text: ready.length
        ? (lang === 'ar'
          ? 'درّب ' + ready.slice(0, 2).map(function (m) { return m.group; }).join(' و') + (ready[0].score >= 85 ? ' — بكامل الشدة، فهي الأعلى جاهزية.' : ' — بشدة معتدلة حتى ترتفع جاهزيتها أكثر.')
          : 'Train ' + ready.slice(0, 2).map(function (m) { return m.group; }).join(' and ') + (ready[0].score >= 85 ? ' — full intensity, they are the most ready.' : ' — at moderate intensity until readiness climbs.'))
        : (lang === 'ar'
          ? 'كل المجموعات ما زالت تستشفي — اجعل اليوم استشفاءً نشطاً: مشي ٢٠-٣٠ دقيقة وتمدد.'
          : 'Every group is still recovering — make today active recovery: a 20-30 min walk and stretching.')
    });
    // Q: How does my soreness affect today?
    if (soreness !== 'none') {
      answers.push({
        icon: 'fa-hand-dots',
        title: L('How does my soreness affect today?', 'كيف يؤثر تعبي العضلي على اليوم؟'),
        text: {
          mild: L('Mild soreness is a good sign of effective training — a proper warm-up will wash it out; you can train normally.', 'التعب الخفيف إشارة جيدة على فاعلية التدريب — الإحماء الجيد سيبدده؛ يمكنك التدريب بشكل طبيعي.'),
          moderate: L('Moderate soreness means the worked muscles are mid-repair — train other groups today or cut intensity by ~20%.', 'التعب المتوسط يعني أن العضلات في منتصف الإصلاح — درّب مجموعات أخرى اليوم أو قلّل الشدة نحو ٢٠٪.'),
          severe: L('Severe soreness = the tissue is still damaged. No hard training today — walking, light stretching and extra protein speed up repair.', 'التعب الشديد يعني أن النسيج ما زال متضرراً — لا تدريب قوي اليوم؛ المشي والتمدد الخفيف والبروتين الإضافي يسرّعون الإصلاح.')
        }[soreness]
      });
    }
    // Q: How did my sleep affect my recovery?
    if (sleepH != null) {
      answers.push({
        icon: 'fa-bed',
        title: L('How did my sleep affect recovery?', 'كيف أثّر نومي على الاستشفاء؟'),
        text: sleepH < 5
          ? L(sleepH + 'h of sleep seriously limits overnight muscle repair — cap today at light training and go to bed 60-90 minutes earlier tonight.', sleepH + ' ساعات نوم تحدّ بشدة من إصلاح العضلات الليلي — اجعل تدريب اليوم خفيفاً فقط ونم الليلة أبكر بـ ٦٠-٩٠ دقيقة.')
          : sleepH < 7
            ? L(sleepH + 'h is just under the recovery sweet spot (7-9h) — expect slightly slower repair and keep one spare rep on heavy sets.', sleepH + ' س أقل قليلاً من نطاق الاستشفاء الأمثل (٧-٩ س) — توقّع إصلاحاً أبطأ قليلاً وأبقِ تكراراً احتياطياً في المجموعات الثقيلة.')
            : L(sleepH + 'h of quality sleep is prime recovery territory — your readiness scores reflect that repair happened.', sleepH + ' س من النوم الجيد هي بيئة الاستشفاء المثالية — درجات الجاهزية تعكس أن الإصلاح حدث.')
      });
    }
    // Q: What about my energy?
    if (energy <= 2 || energy >= 4) {
      answers.push({
        icon: 'fa-bolt',
        title: L('What about my energy level?', 'ماذا عن مستوى طاقتي؟'),
        text: energy <= 2
          ? L('Low energy (' + energy + '/5) usually means under-recovery — shorter session, machine work, and no max attempts today.', 'الطاقة المنخفضة (' + energy + '/٥) تعني غالباً استشفاءً ناقصاً — جلسة أقصر وأجهزة بدل الأوزان الحرة، دون محاولات قصوى اليوم.')
          : L('High energy (' + energy + '/5) on top of your recovery scores — a great window for a PR attempt or an extra working set.', 'الطاقة المرتفعة (' + energy + '/٥) فوق درجات جاهزيتك — نافذة ممتازة لرقم شخصي أو مجموعة إضافية.')
      });
    }
    // Q: Should I train my sore area?
    if (soreArea) {
      const area = muscles.filter(function (m) { return m.groupEn === soreArea; })[0];
      answers.push({
        icon: 'fa-location-crosshairs',
        title: L('Can I train my sore area (' + gname(soreArea) + ')?', 'هل أستطيع تدريب منطقتي المتعبة (' + gname(soreArea) + ')؟'),
        text: (area && area.score < 65)
          ? L('No — ' + gname(soreArea) + ' is at ' + (area ? area.score : '--') + '% readiness. Give it ' + (area && area.readyIn > 0 ? (area.readyIn >= 24 ? Math.round(area.readyIn / 24) + ' more day(s)' : area.readyIn + ' more hour(s)') : 'more rest') + ' and train around it today.', 'لا — جاهزية ' + gname(soreArea) + ' الآن ' + (area ? area.score : '--') + '٪. أعطها ' + (area && area.readyIn > 0 ? (area.readyIn >= 24 ? Math.round(area.readyIn / 24) + ' يوماً إضافياً' : area.readyIn + ' ساعة إضافية') : 'مزيداً من الراحة') + ' ودرّب ما حولها اليوم.')
          : L('Yes — ' + gname(soreArea) + ' is at ' + (area ? area.score : '--') + '% readiness. Warm up extra long and it can handle a normal session.', 'نعم — جاهزية ' + gname(soreArea) + ' الآن ' + (area ? area.score : '--') + '٪. أطل الإحماء وستتحمل جلسة طبيعية.')
      });
    }
    // Q: Is my weekly volume balanced?
    answers.push({
      icon: 'fa-scale-balanced',
      title: L('Is my weekly volume balanced?', 'هل حجم تدريبي الأسبوعي متوازن؟'),
      text: totalLoad === 0
        ? L('No sessions logged in the last 7 days — start with 2-3 moderate sessions this week and build from there.', 'لا جلسات في آخر ٧ أيام — ابدأ بجلستين إلى ثلاث معتدلة هذا الأسبوع ثم تدرّج.')
        : totalLoad > 400
          ? L(totalLoad + ' minutes this week is a heavy load — great work, but your readiness shows it: keep 1-2 easier days before the next hard block.', totalLoad + ' دقيقة هذا الأسبوع حمل ثقيل — عمل رائع، لكن جاهزيتك تعكس ذلك: أبقِ يوماً أو يومين أخف قبل الكتلة الصعبة القادمة.')
          : totalLoad < 120
            ? L(totalLoad + ' minutes this week is on the light side — your muscles are fresh, so add a session or increase workout length for progress.', totalLoad + ' دقيقة هذا الأسبوع خفيفة — عضلاتك منتعشة، فأضف جلسة أو زد مدة التمرين لتحقيق تقدم.')
            : L(totalLoad + ' minutes this week is a healthy, sustainable volume — keep this rhythm.', totalLoad + ' دقيقة هذا الأسبوع حجم صحي ومستدام — حافظ على هذا الإيقاع.')
    });
    // Q: When will my most tired muscle recover?
    const mostTired = muscles.slice().sort(function (a, b) { return a.score - b.score; })[0];
    if (mostTired && mostTired.readyIn > 0) {
      answers.push({
        icon: 'fa-clock',
        title: L('When will ' + mostTired.group + ' recover?', 'متى تستشفي ' + mostTired.group + '؟'),
        text: mostTired.readyIn >= 24
          ? L(mostTired.group + ' is the most fatigued group (' + mostTired.score + '%) — expect full readiness in about ' + Math.round(mostTired.readyIn / 24) + ' more day(s) of normal activity, sleep and protein.', mostTired.group + ' هي الأكثر إجهاداً (' + mostTired.score + '٪) — تتوقع جاهزيتها الكاملة بعد نحو ' + Math.round(mostTired.readyIn / 24) + ' يوم إضافي من النشاط الطبيعي والنوم والبروتين.')
          : L(mostTired.group + ' is close — roughly ' + mostTired.readyIn + ' more hour(s) and it will be ready to train again.', mostTired.group + ' قريبة من الجاهزية — نحو ' + mostTired.readyIn + ' ساعة إضافية وتصبح جاهزة للتدريب مجدداً.')
      });
    }

    // ── 6) Concrete recovery actions (condition-specific) ──
    const actions = [];
    if (sleepH == null || sleepH < 7.5) actions.push(L('Aim for 7-9 hours of sleep tonight — most muscle repair happens then.', 'استهدف ٧-٩ ساعات نوم الليلة — معظم إصلاح العضلات يحدث حينها.'));
    if (soreness !== 'none') actions.push(L('20-30 minutes of easy walking boosts blood flow and clears soreness faster than total rest.', '٢٠-٣٠ دقيقة من المشي الخفيف تنشّط الدورة الدموية وتزيل التعب أسرع من الراحة التامة.'));
    if (soreness === 'severe' || soreArea) actions.push(L('5-10 minutes of gentle mobility/stretching for the sore area, stopping before any sharp pain.', '٥-١٠ دقائق من المرونة والتمدد اللطيف للمنطقة المتعبة، مع التوقف قبل أي ألم حاد.'));
    actions.push(lang === 'ar' ? 'بروتين في كل وجبة (٠.٤ غ لكل كجم) + ٣٥ مل ماء لكل كجم — وقود الإصلاح.' : 'Protein at every meal (0.4g per kg) + 35ml water per kg — the repair fuel.');
    if (energy >= 4 && overall >= 75) actions.push(L('Feeling great? Channel it — your most-ready groups can take an extra set today.', 'تشعر بقوة؟ وجّهها — مجموعاتك الأعلى جاهزية تتحمل مجموعة إضافية اليوم.'));
    if (energy <= 2) actions.push(L('Skip caffeine after 2pm and take a 15-20 minute afternoon nap if you can.', 'تجنب الكافيين بعد الثانية ظهراً وخذ قيلولة ١٥-٢٠ دقيقة إن استطعت.'));
    if (totalLoad > 400) actions.push(L('After this heavy week, plan one full rest or easy-movement day within the next 48h.', 'بعد هذا الأسبوع الثقيل، خطّط ليوم راحة كامل أو حركة خفيفة خلال الـ٤٨ ساعة القادمة.'));

    // ── 7) Injury note (works with the user's condition) ──
    let injuryNote = '';
    if (injury) {
      injuryNote = injury === 'Knees'
        ? L('Knee note: squat/lunge depth comes last — box squats, step-ups to a comfortable height and glute bridges build the same muscle with far less knee stress. Sharp knee pain always means stop.', 'ملاحظة الركبة: عمق السكوات والاندفاع يأتي أخيراً — سكوات الصندوق والصعود على درجة مريحة وتمارين رفع الأرداف تبني نفس العضلات بإجهاد أقل بكثير للركبة. الألم الحاد في الركبة يعني التوقف دائماً.')
        : injury === 'Lower back'
          ? L('Lower-back note: brace before every lift, hinge from the hips, and swap barbell rows for chest-supported rows today. Sharp back pain = stop + professional.', 'ملاحظة أسفل الظهر: اثبّت جسمك قبل كل رفعة، انحنِ من مفصل الورك، واستبدل سحب الباربيل بسحب مدعوم بالصدر اليوم. الألم الحاد في الظهر = توقف واستشر مختصاً.')
          : L('Shoulder note: keep elbows ~45° on presses, avoid behind-the-neck moves, and warm the rotator cuff (band external rotations) before any upper work. Sharp shoulder pain = stop.', 'ملاحظة الكتف: أبقِ المرفقين بزاوية ~٤٥° في الدفع، وتجنب الحركات خلف الرقبة، وأحمِ الكفة المدورة (دورات خارجية بالمطاط) قبل أي تدريب علوي. الألم الحاد في الكتف = توقف.');
    }

    const todayFocus = ready.length
      ? (L('Best picks right now: ', 'الأفضل الآن: ') + ready.slice(0, 2).map(function (m) { return m.group; }).join(' ' + L('and', 'و') + ' ') + (ready[0].score >= 85 ? L(' — go hard.', ' — بشدة كاملة.') : L(' — keep intensity moderate.', ' — حافظ على شدة معتدلة.')))
      : L('Every group is recovering — make today active recovery: a 20-30 min walk, stretching and extra protein.', 'كل المجموعات تستشفي — اجعل اليوم استشفاءً نشطاً: مشي ٢٠-٣٠ دقيقة وتمديد وبروتين إضافي.');
    const tip = sleepPen > 3
      ? L('Your sleep is cutting into recovery — even one extra hour tonight will raise these scores by tomorrow.', 'نومك يقلّل من استشفائك — ساعة إضافية واحدة الليلة سترفع هذه الدرجات غداً.')
      : (totalLoad > 400
        ? L('Big training week — hydration and protein matter double right now.', 'أسبوع تدريبي كبير — الماء والبروتين مهمان مضاعفين الآن.')
        : L('Moderate week so far. The groups marked recovered are where progress happens — hit them hard.', 'أسبوع معتدل حتى الآن. المجموعات المعلمة كمستشفية هي مكان التقدم — درّبها بقوة.'));

    return {
      ok: true, onDevice: false,
      overall: overall, verdict: verdict, summary: summary,
      muscles: muscles, answers: answers, actions: actions,
      todayFocus: todayFocus, avoid: avoid, injuryNote: injuryNote,
      tip: tip, weeklyLoadMin: Math.round(totalLoad)
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // v30 (user): "in recovery iq, make workouts made for the user to recover"
  // — a CONCRETE recovery session generator. recoveryLocal() tells the user
  // HOW they feel; recoveryWorkoutLocal() now also hands them an actual
  // do-this-now recovery workout: a short active-recovery block tailored to
  // the soreness level, the reported sore area, energy, sleep and the
  // survey injury. Every move is light (mobility / breathing / easy
  // movement) — nothing here ever loads a fatigued muscle.
  // Returns { title, totalMin, blocks: [{name, mins, how}] }.
  // ══════════════════════════════════════════════════════════════════════
  var RECOVERY_MOVES = {
    // Per-area mobility / light-active moves: [name, default minutes, how]
    Chest: [
      ['Doorway chest stretch', 2, 'Forearms on the frame, step through gently — 30s per side.'],
      ['Wall slides', 2, 'Back to a wall, slide arms up/down slow — no pain, just flow.'],
      ['Band pull-aparts', 2, 'Light band, 15-20 slow reps to flush the chest and shoulders.']
    ],
    Back: [
      ['Cat-cow', 2, 'On all fours, alternate arch/round with your breath.'],
      ['Knees-to-rock', 2, 'Lying down, hug knees and rock softly side to side.'],
      ['Thoracic rotations', 2, 'On all fours, open one arm to the ceiling — 8 each side.']
    ],
    Legs: [
      ['Walking calf stretch', 2, 'Long steps, back heel down — 30s per leg.'],
      ['Hip flexor lunge hold', 2, 'Half-kneeling, tuck the pelvis, 30s per side.'],
      ['Legs-up-the-wall', 3, 'Sit close to a wall, legs up — breathe slow for 3 min.']
    ],
    Shoulders: [
      ['Pendulum swings', 2, 'Bend over, let a light arm hang and circle gently.'],
      ['Cross-body stretch', 2, 'Pull one arm across the chest — 30s per side.'],
      ['External rotations', 2, 'Elbow at the side, rotate out with a light band.']
    ],
    Arms: [
      ['Wrist + forearm rolls', 2, 'Open and close fists, roll wrists both ways.'],
      ['Triceps overhead stretch', 2, 'Elbow up, hand down the back — 30s per arm.'],
      ['Biceps wall stretch', 2, 'Arm back on the wall, turn away slowly.']
    ],
    Core: [
      ['Child\u2019s pose', 2, 'Knees wide, arms long — deep belly breaths.'],
      ['Dead bug (slow)', 2, 'Lying down, opposite arm/leg lower with control.'],
      ['Supine twist', 2, 'Lying down, knees drop to one side — 30s each.']
    ],
    'Full Body': [
      ['Full-body stretch flow', 3, 'Reach up, fold forward, sweep side to side with breath.'],
      ['Slow march in place', 2, 'Easy tempo, tall posture, swing the arms loosely.']
    ]
  };
  function recoveryWorkoutLocal(weekLogs, inputs, opts) {
    inputs = inputs || {};
    opts = opts || {};
    const lang = (opts.lang === 'ar') ? 'ar' : 'en';
    const L = function (en, ar) { return lang === 'ar' ? ar : en; };
    const soreness = ['none', 'mild', 'moderate', 'severe'].indexOf(inputs.soreness) >= 0 ? inputs.soreness : 'none';
    const energy = (inputs.energy != null && isFinite(inputs.energy)) ? Math.max(1, Math.min(5, Number(inputs.energy))) : 3;
    const sleepH = (inputs.sleepH != null && isFinite(inputs.sleepH) && inputs.sleepH > 0) ? Number(inputs.sleepH) : null;
    const soreArea = (typeof inputs.soreArea === 'string' && inputs.soreArea) ? inputs.soreArea : '';
    const injury = (typeof opts.injury === 'string' && opts.injury && opts.injury !== 'None') ? opts.injury : '';

    // Overall session size scales DOWN with soreness, LOW energy and bad sleep.
    let size = 1;                                     // 0 = short, 1 = normal, 2 = full
    if (soreness === 'moderate' || (energy <= 2) || (sleepH != null && sleepH < 6)) size = 0;
    if (soreness === 'severe') size = 0;
    if (soreness === 'none' && energy >= 4 && size !== 0) size = 2;

    const blocks = [];
    const pushBlock = function (name, mins, how) { blocks.push({ name: (lang === 'ar' ? name : name), mins: mins, how: how }); };

    // 1) Always: easy circulation starter (walk) — length scales with state.
    const walkMin = size === 0 ? 8 : size === 2 ? 15 : 12;
    pushBlock(lang === 'ar' ? ('مشي خفيف — ' + walkMin + ' دقائق') : ('Easy walk — ' + walkMin + ' min'),
      walkMin,
      lang === 'ar' ? 'إيقاع مريح يرفع نبضك قليلاً فقط — الدورة الدموية تسرّع الإصلاح.' : 'Comfortable pace, breathing easy — blood flow speeds repair.');

    // 2) The sore area gets targeted mobility (or the most-tired groups from the week).
    var areas = [];
    if (soreArea) areas = [soreArea];
    else {
      // derive from weekLogs fatigue (same decay idea as recoveryLocal, simplified)
      const fatigue = { Chest: 0, Back: 0, Legs: 0, Shoulders: 0, Arms: 0, Core: 0 };
      const now = Date.now();
      (weekLogs || []).forEach(function (s) {
        const d = new Date((s.date || '') + 'T12:00:00');
        if (isNaN(d)) return;
        const hours = Math.max(0, (now - d.getTime()) / 36e5);
        if (hours > 24 * 8) return;
        const decay = Math.exp(-hours / 42);
        const load = (Math.max(5, Math.min(180, Number(s.minutes) || 30))) * 0.55 * decay;
        (s.muscleGroups && s.muscleGroups.length ? s.muscleGroups : ['Full Body']).forEach(function (g) {
          if (fatigue[g] != null) fatigue[g] += load;
          else Object.keys(fatigue).forEach(function (g2) { fatigue[g2] += load * 0.45; });
        });
      });
      areas = Object.keys(fatigue).sort(function (a, b) { return fatigue[b] - fatigue[a]; }).slice(0, 2);
    }
    const moveCount = size === 0 ? 2 : 3;
    areas.slice(0, 2).forEach(function (area) {
      const moves = RECOVERY_MOVES[area] || RECOVERY_MOVES['Full Body'];
      for (var i = 0; i < Math.min(moveCount, moves.length); i++) {
        const m = moves[i];
        pushBlock(lang === 'ar' ? (m[0] + ' — ' + m[1] + ' د') : (m[0] + ' — ' + m[1] + ' min'), m[1],
          lang === 'ar' ? m[2] : m[2]);
      }
    });

    // 3) Always finish: breathing down-regulation (sleep debt → longer).
    const breathMin = (sleepH != null && sleepH < 7) ? 3 : 2;
    pushBlock(lang === 'ar' ? ('تنفس عميق (٤-٧-٨) — ' + breathMin + ' د') : ('Deep breathing (4-7-8) — ' + breathMin + ' min'),
      breathMin,
      lang === 'ar' ? 'شهيق ٤ ثوان، حبس ٧، زفير 8 — يخفض التوتر ويحسّن النوم.' : 'In 4s, hold 7s, out 8s — lowers stress and improves tonight\u2019s sleep.');

    // 4) Injury guard: swap risky moves for safe alternatives.
    if (injury === 'Knees') {
      blocks.push({ name: lang === 'ar' ? 'تمرين آمن للركبة — رفع الأرداف' : 'Knee-safe addition — glute bridges', mins: 2,
        how: lang === 'ar' ? 'رقدة ورفع الأرداف ببطء — يقوّي ما حول الركبة دون إجهادها.' : 'Lying down, lift the hips slowly — strengthens around the knee without stressing it.' });
    } else if (injury === 'Lower back') {
      blocks.push({ name: lang === 'ar' ? 'تمرين آمن لأسفل الظهر — Pellvic tilt' : 'Lower-back-safe addition — pelvic tilts', mins: 2,
        how: lang === 'ar' ? 'رقدة مع ثني الركبتين، اضبط الحوض بلطف ذهاباً وإياباً.' : 'Lying with knees bent, gently rock the pelvis back and forth.' });
    } else if (injury === 'Shoulders') {
      blocks.push({ name: lang === 'ar' ? 'تمرين آمن للكتف — دوران خارجي خفيف' : 'Shoulder-safe addition — light external rotations', mins: 2,
        how: lang === 'ar' ? 'مرفقك بجانبك، دوران خارجي بطيء بمطاط خفيف.' : 'Elbow pinned at your side, slow outward rotations with a light band.' });
    }

    const totalMin = blocks.reduce(function (a, b) { return a + b.mins; }, 0);
    const title = soreness === 'severe'
      ? L('Gentle Recovery Session', 'جلسة استشفاء لطيفة')
      : soreness === 'none'
        ? L('Active Recovery Session', 'جلسة استشفاء نشط')
        : L('Recovery Session', 'جلسة الاستشفاء');
    return {
      title: title,
      totalMin: totalMin,
      blocks: blocks,
      note: L('Do everything at an easy pace — you should finish feeling LOOSER and more awake, never tired.', 'نفّذ كل شيء بإيقاع سهل — يجب أن تنتهي وأنت أكثر مرونة وحيوية، وليس متعباً.')
    };
  }

  return {
    MotionRepCounter: MotionRepCounter,
    formCheckLocal: formCheckLocal,
    progressionLocal: progressionLocal,
    recoveryLocal: recoveryLocal,
    recoveryWorkoutLocal: recoveryWorkoutLocal,
    muscleOf: muscleOf
  };
})();
