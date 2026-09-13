/**
 * Volta — Cloud Models  (design layer for the Weather & Safety sky)
 * =================================================================
 * Replaces the original single-style bumpy-path clouds with 6 distinct
 * cloud "models" (Grand Slam, Speedster, Twin Peaks, Pancake Drifter,
 * Storm Tower, Lil' Puff). Each cloud is built from layered puffs with
 * a soft base shadow — same palette as the original cloud gradient
 * (#ffffff / #f0f4f8 / #c8d2dc), so day/night/rain/snow filters in
 * volta.css keep working untouched.
 *
 * Pure override of the global renderRandomClouds(): texts, colors and
 * all other app logic are unaffected. If this file fails to load, the
 * original renderer still works.
 */
(function () {
  'use strict';

  /* Each model = list of puffs.
     [cx, cy, r] = circle   |   [cx, cy, rx, ry] = ellipse (flat base) */
  var CLOUD_MODELS = [
    /* 0 — Grand Slam: big classic cumulus */
    [[38, 38, 16], [58, 29, 20], [80, 36, 15], [96, 45, 9], [58, 49, 40, 11]],
    /* 1 — Speedster: stretched, trailing puff + speed dashes */
    [[34, 40, 12], [54, 32, 16], [76, 38, 13], [101, 46, 6], [56, 49, 38, 9]],
    /* 2 — Twin Peaks: two dominant towers, shared base */
    [[40, 34, 16], [75, 36, 15], [57, 44, 12], [57, 51, 36, 8]],
    /* 3 — Pancake Drifter: low & wide */
    [[40, 38, 12], [62, 33, 14], [85, 38, 11], [61, 47, 42, 10]],
    /* 4 — Storm Tower: tall centre stack */
    [[60, 27, 18], [43, 40, 13], [78, 40, 13], [60, 50, 35, 9]],
    /* 5 — Lil' Puff: small companion cloud */
    [[49, 39, 14], [68, 42, 11], [58, 50, 27, 8]]
  ];

  function puffShapes(model) {
    return model.map(function (c) {
      return c.length === 4
        ? '<ellipse cx="' + c[0] + '" cy="' + c[1] + '" rx="' + c[2] + '" ry="' + c[3] + '"/>'
        : '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '"/>';
    }).join('');
  }

  function cloudSVG(modelIdx, idx) {
    var model = CLOUD_MODELS[modelIdx % CLOUD_MODELS.length];
    var shapes = puffShapes(model);
    /* vertical shading — same stops as the original cloud gradient */
    var gid = 'vcloudGrad-' + idx;
    var svg = '<svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg" class="cloud-svg">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="10" x2="0" y2="60" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#ffffff"/>' +
      '<stop offset=".6" stop-color="#f0f4f8"/>' +
      '<stop offset="1" stop-color="#c8d2dc"/>' +
      '</linearGradient></defs>' +
      /* soft base shadow (offset silhouette) */
      '<g fill="#c8d2dc" opacity=".45" transform="translate(0,3.5)">' + shapes + '</g>' +
      /* main body */
      '<g fill="url(#' + gid + ')">' + shapes + '</g>';
    /* Speedster only: two small motion dashes trailing left */
    if (modelIdx % CLOUD_MODELS.length === 1) {
      svg += '<rect x="2" y="44" width="10" height="3" rx="1.5" fill="#f0f4f8"/>' +
             '<rect x="7" y="50" width="7" height="3" rx="1.5" fill="#f0f4f8"/>';
    }
    return svg + '</svg>';
  }

  /* Override the global renderer (declared with `function` in volta.js,
     so assigning window.renderRandomClouds replaces what renderWeather
     calls). Keeps the data-shape → model mapping behaviour. */
  window.renderRandomClouds = function () {
    var clouds = document.querySelectorAll('.weather-clouds-row .weather-cloud');
    clouds.forEach(function (cloud, idx) {
      var m = parseInt(cloud.getAttribute('data-shape'), 10);
      if (isNaN(m)) m = idx % CLOUD_MODELS.length;
      cloud.innerHTML = cloudSVG(m, idx);
    });
  };
})();
