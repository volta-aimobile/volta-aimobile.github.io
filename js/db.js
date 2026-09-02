/**
 * Volta DB — IndexedDB wrapper with query API
 * ============================================
 *
 * This is the app's real backend. All meal and workout data lives here,
 * persisted in IndexedDB so it survives page reloads, offline use, and
 * cache eviction (unlike localStorage which can be silently cleared).
 *
 * SCHEMA (volta_db v1)
 * --------------------
 *   meals     {id, name, desc, kcal, p, c, f, fiber, diet, mealType,
 *              cuisine, tags[], ingredients[], recipe[], image}
 *   workouts  {id, name, muscleGroup, equipment, difficulty, sport,
 *              met, duration, calories, description, steps[], tips[], image}
 *   dietLog   {id, email, date, name, kcal, protein, carbs, fat, fiber,
 *              serving, mealType, loggedAt, barcode, brand, coachAssigned}
 *   users     {email, ...userObject}  (mirror of fb_users)
 *   settings  {key, value}
 *
 * QUERY API
 * ---------
 *   VoltaDB.init()              → Promise<void>  (opens DB, seeds if empty)
 *   VoltaDB.meals.getAll()      → Promise<Meal[]>
 *   VoltaDB.meals.filter(opts)  → Promise<Meal[]>  (opts: {diet, mealType, cuisine, maxKcal, tags})
 *   VoltaDB.meals.search(q)     → Promise<Meal[]>
 *   VoltaDB.meals.getById(id)   → Promise<Meal|null>
 *   VoltaDB.meals.getByType(t)  → Promise<Meal[]>
 *   VoltaDB.workouts.getAll()   → Promise<Workout[]>
 *   VoltaDB.workouts.filter(o)  → Promise<Workout[]>  (opts: {muscleGroup, equipment, difficulty, sport})
 *   VoltaDB.workouts.search(q)  → Promise<Workout[]>
 *   VoltaDB.workouts.getById(id)→ Promise<Workout|null>
 *   VoltaDB.workouts.getRandom(count, filter) → Promise<Workout[]>
 *   VoltaDB.dietLog.getByEmail(email) → Promise<DietLogEntry[]>
 *   VoltaDB.dietLog.add(entry)        → Promise<void>
 *   VoltaDB.dietLog.delete(id)        → Promise<void>
 *   VoltaDB.users.get(email)    → Promise<User|null>
 *   VoltaDB.users.save(user)    → Promise<void>
 *
 * SEEDING
 * -------
 * On first run (or if stores are empty), VoltaDB.init() loads seed data
 * from window.VOLTA_MEAL_SEED and window.VOLTA_WORKOUT_SEED arrays.
 * These are defined in js/data/meals.js and js/data/workouts.js.
 */

const VoltaDB = (function () {
  const DB_NAME = 'volta_db';
  const DB_VERSION = 1;
  const STORES = ['meals', 'workouts', 'dietLog', 'users', 'settings'];

  let db = null;
  let initPromise = null;

  // ─── Internal: open the database and create stores + indexes ─────────────
  function open() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        const d = e.target.result;

        // meals store — keyed by autoIncrement id
        if (!d.objectStoreNames.contains('meals')) {
          const meals = d.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
          meals.createIndex('name', 'name', { unique: false });
          meals.createIndex('diet', 'diet', { unique: false });
          meals.createIndex('mealType', 'mealType', { unique: false });
          meals.createIndex('cuisine', 'cuisine', { unique: false });
          meals.createIndex('kcal', 'kcal', { unique: false });
        }

        // workouts store
        if (!d.objectStoreNames.contains('workouts')) {
          const w = d.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
          w.createIndex('name', 'name', { unique: false });
          w.createIndex('muscleGroup', 'muscleGroup', { unique: false });
          w.createIndex('equipment', 'equipment', { unique: false });
          w.createIndex('difficulty', 'difficulty', { unique: false });
          w.createIndex('sport', 'sport', { unique: false });
        }

        // dietLog store — per-user diet log entries
        if (!d.objectStoreNames.contains('dietLog')) {
          const dl = d.createObjectStore('dietLog', { keyPath: 'id', autoIncrement: true });
          dl.createIndex('email', 'email', { unique: false });
          dl.createIndex('date', 'date', { unique: false });
          dl.createIndex('email_date', ['email', 'date'], { unique: false });
        }

        // users store — mirror of fb_users
        if (!d.objectStoreNames.contains('users')) {
          d.createObjectStore('users', { keyPath: 'email' });
        }

        // settings store — key/value pairs
        if (!d.objectStoreNames.contains('settings')) {
          d.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // ─── Internal: generic store operations ──────────────────────────────────
  function tx(storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function getAll(storeName) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readonly').getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function put(storeName, data) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readwrite').put(data);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function bulkPut(storeName, items) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      items.forEach(function (item) { store.put(item); });
      transaction.oncomplete = function () { resolve(items.length); };
      transaction.onerror = function () { reject(transaction.error); };
    });
  }

  function getById(storeName, key) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readonly').get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function deleteById(storeName, key) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readwrite').delete(key);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function count(storeName) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readonly').count();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function clearStore(storeName) {
    return new Promise(function (resolve, reject) {
      const req = tx(storeName, 'readwrite').clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ─── Internal: seed meals and workouts if stores are empty ───────────────
  async function seedIfEmpty() {
    try {
      const mealCount = await count('meals');
      if (mealCount === 0 && window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) {
        console.log('[VoltaDB] Seeding ' + window.VOLTA_MEAL_SEED.length + ' meals...');
        await bulkPut('meals', window.VOLTA_MEAL_SEED);
        console.log('[VoltaDB] Meals seeded.');
      }

      const workoutCount = await count('workouts');
      if (workoutCount === 0 && window.VOLTA_WORKOUT_SEED && window.VOLTA_WORKOUT_SEED.length) {
        console.log('[VoltaDB] Seeding ' + window.VOLTA_WORKOUT_SEED.length + ' workouts...');
        await bulkPut('workouts', window.VOLTA_WORKOUT_SEED);
        console.log('[VoltaDB] Workouts seeded.');
      }
    } catch (e) {
      console.warn('[VoltaDB] Seed error:', e);
    }
  }

  // ─── Public: initialize the database ─────────────────────────────────────
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async function () {
      try {
        db = await open();
        await seedIfEmpty();
        console.log('[VoltaDB] Ready. Stores:', STORES.join(', '));
        return;
      } catch (e) {
        console.error('[VoltaDB] Init failed:', e);
        throw e;
      }
    })();
    return initPromise;
  }

  // ─── Public: meals API ───────────────────────────────────────────────────
  const meals = {
    async getAll() { return getAll('meals'); },

    async getById(id) { return getById('meals', id); },

    /**
     * Filter meals by one or more criteria. All criteria are AND-combined.
     * @param {Object} opts
     *   {string} [opts.diet]       — 'omnivore'|'vegetarian'|'vegan'|'keto'|'halal'|'gluten-free'
     *   {string} [opts.mealType]   — 'breakfast'|'lunch'|'dinner'|'snack'
     *   {string} [opts.cuisine]    — e.g. 'Mediterranean', 'Asian', 'Mexican'
     *   {number} [opts.maxKcal]    — only meals with kcal <= this
     *   {number} [opts.minProtein] — only meals with p >= this
     *   {string[]} [opts.tags]     — meals must include ALL these tags
     *   {number} [opts.limit]      — max results
     */
    async filter(opts) {
      opts = opts || {};
      let items = await getAll('meals');
      if (opts.diet) {
        // 'omnivore' matches everything; 'vegetarian' matches vegetarian+vegan;
        // 'vegan' matches vegan only; others match exact.
        items = items.filter(function (m) {
          if (opts.diet === 'omnivore') return true;
          if (opts.diet === 'vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
          if (opts.diet === 'halal') return m.diet === 'halal' || m.diet === 'omnivore' || !m.diet;
          if (opts.diet === 'gluten-free') return m.diet === 'gluten-free' || m.diet === 'omnivore' || !m.diet;
          if (opts.diet === 'keto') return m.diet === 'keto';
          return m.diet === opts.diet;
        });
      }
      if (opts.mealType) items = items.filter(function (m) { return m.mealType === opts.mealType; });
      if (opts.cuisine) items = items.filter(function (m) { return m.cuisine === opts.cuisine; });
      if (typeof opts.maxKcal === 'number') items = items.filter(function (m) { return m.kcal <= opts.maxKcal; });
      if (typeof opts.minProtein === 'number') items = items.filter(function (m) { return m.p >= opts.minProtein; });
      if (Array.isArray(opts.tags) && opts.tags.length) {
        items = items.filter(function (m) {
          var mt = m.tags || [];
          return opts.tags.every(function (t) { return mt.indexOf(t) !== -1; });
        });
      }
      if (opts.limit) items = items.slice(0, opts.limit);
      return items;
    },

    async search(query) {
      if (!query) return [];
      var q = query.toLowerCase().trim();
      var items = await getAll('meals');
      return items.filter(function (m) {
        return (m.name && m.name.toLowerCase().indexOf(q) !== -1) ||
               (m.desc && m.desc.toLowerCase().indexOf(q) !== -1) ||
               (m.cuisine && m.cuisine.toLowerCase().indexOf(q) !== -1) ||
               (m.tags && m.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; }));
      });
    },

    async getByType(mealType, limit) {
      return meals.filter({ mealType: mealType, limit: limit });
    },

    /**
     * Pick N random meals, optionally filtered. Uses a deterministic daily
     * seed (based on day-of-year) so the same user sees the same meals all
     * day, then they rotate tomorrow. Matches the old getDailyItems behavior.
     */
    async getDailyPicks(count, opts) {
      var items = await meals.filter(opts);
      if (items.length === 0) return [];
      var dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      var result = [];
      var pool = items.slice();
      // Simple deterministic shuffle seeded by dayOfYear
      var seed = dayOfYear;
      function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      for (var i = 0; i < Math.min(count, pool.length); i++) {
        var idx = Math.floor(rand() * pool.length);
        result.push(pool.splice(idx, 1)[0]);
      }
      return result;
    },

    async count() { return count('meals'); },

    async reseed() {
      await clearStore('meals');
      if (window.VOLTA_MEAL_SEED) await bulkPut('meals', window.VOLTA_MEAL_SEED);
    }
  };

  // ─── Public: workouts API ────────────────────────────────────────────────
  const workouts = {
    async getAll() { return getAll('workouts'); },

    async getById(id) { return getById('workouts', id); },

    /**
     * Filter workouts by one or more criteria. All criteria are AND-combined.
     * @param {Object} opts
     *   {string} [opts.muscleGroup] — 'Chest'|'Back'|'Legs'|'Shoulders'|'Arms'|'Core'|'Cardio'|'Full Body'
     *   {string} [opts.equipment]   — 'Bodyweight'|'Dumbbell'|'Barbell'|'Kettlebell'|'Machine'|'Bands'
     *   {string} [opts.difficulty]  — 'Beginner'|'Intermediate'|'Advanced'
     *   {string} [opts.sport]       — e.g. 'Running', 'Yoga', 'Boxing'
     *   {number} [opts.limit]       — max results
     */
    async filter(opts) {
      opts = opts || {};
      var items = await getAll('workouts');
      if (opts.muscleGroup) items = items.filter(function (w) { return w.muscleGroup === opts.muscleGroup; });
      if (opts.equipment) items = items.filter(function (w) {
        if (Array.isArray(w.equipment)) return w.equipment.indexOf(opts.equipment) !== -1;
        return w.equipment === opts.equipment;
      });
      if (opts.difficulty) items = items.filter(function (w) { return w.difficulty === opts.difficulty; });
      if (opts.sport) items = items.filter(function (w) { return w.sport === opts.sport; });
      if (opts.limit) items = items.slice(0, opts.limit);
      return items;
    },

    async search(query) {
      if (!query) return [];
      var q = query.toLowerCase().trim();
      var items = await getAll('workouts');
      return items.filter(function (w) {
        return (w.name && w.name.toLowerCase().indexOf(q) !== -1) ||
               (w.description && w.description.toLowerCase().indexOf(q) !== -1) ||
               (w.muscleGroup && w.muscleGroup.toLowerCase().indexOf(q) !== -1);
      });
    },

    async getRandom(count, opts) {
      var items = await workouts.filter(opts);
      if (items.length === 0) return [];
      var result = [];
      var pool = items.slice();
      for (var i = 0; i < Math.min(count, pool.length); i++) {
        var idx = Math.floor(Math.random() * pool.length);
        result.push(pool.splice(idx, 1)[0]);
      }
      return result;
    },

    async count() { return count('workouts'); },

    async reseed() {
      await clearStore('workouts');
      if (window.VOLTA_WORKOUT_SEED) await bulkPut('workouts', window.VOLTA_WORKOUT_SEED);
    }
  };

  // ─── Public: dietLog API ─────────────────────────────────────────────────
  const dietLog = {
    async getByEmail(email) {
      return new Promise(function (resolve, reject) {
        var index = tx('dietLog', 'readonly').index('email');
        var req = index.getAll(email);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    },

    async getByEmailAndDate(email, date) {
      return new Promise(function (resolve, reject) {
        var index = tx('dietLog', 'readonly').index('email_date');
        var req = index.getAll([email, date]);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    },

    async add(entry) { return put('dietLog', entry); },

    async delete(id) { return deleteById('dietLog', id); },

    async deleteByEmail(email) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction('dietLog', 'readwrite');
        var store = transaction.objectStore('dietLog');
        var index = store.index('email');
        var req = index.openCursor(email);
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
        };
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { reject(transaction.error); };
      });
    }
  };

  // ─── Public: users API ───────────────────────────────────────────────────
  const users = {
    async get(email) { return getById('users', email); },
    async save(user) {
      if (!user.email) throw new Error('User must have an email field');
      return put('users', user);
    },
    async getAll() { return getAll('users'); }
  };

  // ─── Public: settings API ────────────────────────────────────────────────
  const settings = {
    async get(key) {
      var r = await getById('settings', key);
      return r ? r.value : null;
    },
    async set(key, value) { return put('settings', { key: key, value: value }); }
  };

  return {
    init: init,
    meals: meals,
    workouts: workouts,
    dietLog: dietLog,
    users: users,
    settings: settings,
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION
  };
})();

// Expose globally
window.VoltaDB = VoltaDB;
