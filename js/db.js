 












































const VoltaDB = (function () {
  const DB_NAME = 'volta_db';
  const DB_VERSION = 1;
  const STORES = ['meals', 'workouts', 'dietLog', 'users', 'settings'];

  let db = null;
  let initPromise = null;

   
  function open() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        const d = e.target.result;

         
        if (!d.objectStoreNames.contains('meals')) {
          const meals = d.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
          meals.createIndex('name', 'name', { unique: false });
          meals.createIndex('diet', 'diet', { unique: false });
          meals.createIndex('mealType', 'mealType', { unique: false });
          meals.createIndex('cuisine', 'cuisine', { unique: false });
          meals.createIndex('kcal', 'kcal', { unique: false });
        }

         
        if (!d.objectStoreNames.contains('workouts')) {
          const w = d.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
          w.createIndex('name', 'name', { unique: false });
          w.createIndex('muscleGroup', 'muscleGroup', { unique: false });
          w.createIndex('equipment', 'equipment', { unique: false });
          w.createIndex('difficulty', 'difficulty', { unique: false });
          w.createIndex('sport', 'sport', { unique: false });
        }

         
        if (!d.objectStoreNames.contains('dietLog')) {
          const dl = d.createObjectStore('dietLog', { keyPath: 'id', autoIncrement: true });
          dl.createIndex('email', 'email', { unique: false });
          dl.createIndex('date', 'date', { unique: false });
          dl.createIndex('email_date', ['email', 'date'], { unique: false });
        }

         
        if (!d.objectStoreNames.contains('users')) {
          d.createObjectStore('users', { keyPath: 'email' });
        }

         
        if (!d.objectStoreNames.contains('settings')) {
          d.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

   
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

   
  async function seedIfEmpty() {
    try {
      const mealCount = await count('meals');
      if (mealCount === 0 && window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) {
        console.log('[VoltaDB] Seeding ' + window.VOLTA_MEAL_SEED.length + ' meals...');
        await bulkPut('meals', window.VOLTA_MEAL_SEED);
        console.log('[VoltaDB] Meals seeded.');
      }

       
       
       
       
      try {
        const cmSeeded = await getById('settings', 'country_seed_v52');
        const pools = window.VOLTA_COUNTRY_MEALS || {};
        const poolNames = Object.keys(pools);
        if ((!cmSeeded || !cmSeeded.value) && poolNames.length) {
          let all = [];
          poolNames.forEach(function (p) { all = all.concat(pools[p]); });
           
           
          all = all.map(function (m, i) {
            const copy = Object.assign({}, m);
            copy.id = 'c52_' + i + '_' + String(m.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
            return copy;
          });
          console.log('[VoltaDB] Seeding ' + all.length + ' country meals...');
          await bulkPut('meals', all);
          await put('settings', { key: 'country_seed_v52', value: all.length });
          console.log('[VoltaDB] Country meals seeded.');
        }
      } catch (e) { console.warn('[VoltaDB] country seed skipped:', e); }

       
       
       
       
       
      try {
        const v60Seeded = await getById('settings', 'country_seed_v60');
        const pools60 = window.VOLTA_COUNTRY_MEALS_V60 || {};
        const pool60Names = Object.keys(pools60);
        if ((!v60Seeded || !v60Seeded.value) && pool60Names.length) {
          let all60 = [];
          pool60Names.forEach(function (p) { all60 = all60.concat(pools60[p] || []); });
          all60 = all60.map(function (m, i) {
            const copy = Object.assign({}, m);
            copy.id = 'c60_' + i + '_' + String(m.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
            return copy;
          });
          console.log('[VoltaDB] Seeding ' + all60.length + ' v60 country meals...');
          await bulkPut('meals', all60);
          await put('settings', { key: 'country_seed_v60', value: all60.length });
          console.log('[VoltaDB] v60 country meals seeded.');
        }
      } catch (e) { console.warn('[VoltaDB] v60 country seed skipped:', e); }

       
       
       
       
       
       
       
       
       
      try {
        const workoutCountPre = await count('workouts');
        if (workoutCountPre > 0) {
          const w60Seeded = await getById('settings', 'workout_seed_v60');
          if ((!w60Seeded || !w60Seeded.value) && window.VOLTA_WORKOUT_SEED_V60 && window.VOLTA_WORKOUT_SEED_V60.length) {
            const existing = await getAll('workouts');
            const have = {};
            (existing || []).forEach(function (w) { have[String(w.name || '').toLowerCase()] = 1; });
            const fresh = window.VOLTA_WORKOUT_SEED_V60.filter(function (w) { return !have[String(w.name || '').toLowerCase()]; });
            if (fresh.length) {
              console.log('[VoltaDB] Seeding ' + fresh.length + ' v60 workouts...');
              await bulkPut('workouts', fresh);
            }
            await put('settings', { key: 'workout_seed_v60', value: window.VOLTA_WORKOUT_SEED_V60.length });
            console.log('[VoltaDB] v60 workouts seeded.');
          }
        }
      } catch (e) { console.warn('[VoltaDB] v60 workout seed skipped:', e); }

      const workoutCount = await count('workouts');
      const workoutSeed = (window.VOLTA_WORKOUT_SEED || []).concat(window.VOLTA_WORKOUT_SEED_V60 || []);
      if (workoutCount === 0 && workoutSeed.length) {
        console.log('[VoltaDB] Seeding ' + workoutSeed.length + ' workouts...');
        await bulkPut('workouts', workoutSeed);
        console.log('[VoltaDB] Workouts seeded.');
      }
    } catch (e) {
      console.warn('[VoltaDB] Seed error:', e);
    }
  }

   
   
   
   
   
   
  const HALAL_FOOD_FILTER = /\b(bacon|pork|ham|prosciutto|chorizo|pancetta|salami|pepperoni|guanciale|andouille|lard|pork belly|ham hock|sushi|sashimi|wine|beer|rum|vodka|whiskey|whisky|tequila|brandy|liqueur|sake|mirin|cooking wine|white wine|red wine|marshmallow|jello|gelatin|black pudding|blood sausage|escargot)\b/i;
  function isHaramMeal(m) {
    try {
      const hay = [m && m.name, m && m.desc, ((m && m.ingredients) || []).join(' '), ((m && m.tags) || []).join(' ')].join(' ');
      return HALAL_FOOD_FILTER.test(hay || '');
    } catch (e) { return false; }
  }
  async function sanitizeMeals() {
    return new Promise(function (resolve) {
      try {
        const transaction = db.transaction('meals', 'readwrite');
        const store = transaction.objectStore('meals');
        let removed = 0;
        const req = store.openCursor();
        req.onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) {
            if (isHaramMeal(cursor.value)) { cursor.delete(); removed++; }
            cursor.continue();
          }
        };
        transaction.oncomplete = function () {
          if (removed) console.log('[VoltaDB] Halal sanitizer removed ' + removed + ' meals.');
          resolve(removed);
        };
        transaction.onerror = function () { resolve(0); };
      } catch (e) { resolve(0); }
    });
  }

   
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async function () {
      try {
        db = await open();
        await seedIfEmpty();
         
         
        await sanitizeMeals();
        console.log('[VoltaDB] Ready. Stores:', STORES.join(', '));
        return;
      } catch (e) {
        console.error('[VoltaDB] Init failed:', e);
        throw e;
      }
    })();
    return initPromise;
  }

   
  const meals = {
    async getAll() { return getAll('meals'); },

    async getById(id) { return getById('meals', id); },

     










    async filter(opts) {
      opts = opts || {};
      let items = await getAll('meals');
      if (opts.diet) {
         
         
         
         
         
        items = items.filter(function (m) {
          if (opts.diet === 'omnivore') return true;
          if (opts.diet === 'vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
          if (opts.diet === 'halal') return m.diet === 'halal' || m.diet === 'omnivore' || !m.diet;
          if (opts.diet === 'gluten-free') {
            var tags = (m.tags || []).map(function (t) { return String(t).toLowerCase(); });
            if (tags.indexOf('allergen: gluten') !== -1) return false;
            if (m.diet === 'gluten-free' || tags.indexOf('gluten free') !== -1) return true;
            var blob = [m.name, m.desc, (m.ingredients || []).join(' ')].join(' ').toLowerCase();
            return !/(wheat|barley|bulgur|couscous|semolina|pita|pasta|noodle|bread|tortilla|wrap|breadcrumb|malt|flour|soy sauce|oatmeal|rolled oats|croissant|bagel|pretzel)/.test(blob);
          }
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

     




    async getDailyPicks(count, opts) {
      var items = await meals.filter(opts);
      if (items.length === 0) return [];
      var dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      var result = [];
      var pool = items.slice();
       
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
    },

     
    isHaram: isHaramMeal
  };

   
  const workouts = {
    async getAll() { return getAll('workouts'); },

    async getById(id) { return getById('workouts', id); },

     








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
      if (window.VOLTA_WORKOUT_SEED_V60) await bulkPut('workouts', window.VOLTA_WORKOUT_SEED_V60);
    }
  };

   
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

   
  const users = {
    async get(email) { return getById('users', email); },
    async save(user) {
      if (!user.email) throw new Error('User must have an email field');
      return put('users', user);
    },
    async getAll() { return getAll('users'); }
  };

   
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

 
window.VoltaDB = VoltaDB;
