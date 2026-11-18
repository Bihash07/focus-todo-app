/* Focus — optional cloud sync (Supabase). Works as a progressive enhancement. */
(() => {
  'use strict';

  const CONFIG_STORAGE_KEY = 'focus.sync.config.v1';
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  const $ = (selector, root = document) => root.querySelector(selector);

  let supabase = null;
  let currentSession = null;
  let syncingActive = false;
  let isSyncing = false;
  let pendingSync = false;
  let syncTimer = 0;
  let channel = null;
  let lastSyncedAt = 0;
  let supabaseInitStarted = false;

  function getStoredConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.url === 'string' && typeof parsed.key === 'string') return parsed;
      }
    } catch (error) {
      /* no-op */
    }
    return null;
  }

  function getConfig() {
    const fromFile = window.FOCUS_CONFIG || {};
    const fromStorage = getStoredConfig();
    return {
      url: String(fromFile.supabaseUrl || fromStorage?.url || '').trim(),
      key: String(fromFile.supabaseAnonKey || fromStorage?.key || '').trim(),
    };
  }

  function isConfigured() {
    const { url, key } = getConfig();
    return /^https:\/\/.+\.supabase\.co\/?$/.test(url) && key.length >= 20;
  }

  function canonical(tasks) {
    return JSON.stringify(
      (tasks || [])
        .map((task) => ({ ...task }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    );
  }

  function setSyncState(state) {
    const dot = $('#syncDot');
    if (dot) dot.dataset.state = state;
    const button = $('#syncBtn');
    if (button) {
      const { url } = getConfig();
      if (!isConfigured()) button.title = 'Set up cloud sync';
      else if (!currentSession) button.title = 'Sign in to sync';
      else button.title = `Synced as ${currentSession.user?.email || 'signed in'}`;
    }
  }

  function showSection(id) {
    ['syncSetup', 'syncSignIn', 'syncAccount', 'syncLoading'].forEach((sectionId) => {
      const element = document.getElementById(sectionId);
      if (element) element.hidden = sectionId !== id;
    });
  }

  function populateConfigInputs() {
    const { url, key } = getConfig();
    const urlInput = $('#syncUrlInput');
    const keyInput = $('#syncKeyInput');
    if (urlInput && !urlInput.value) urlInput.value = url;
    if (keyInput && !keyInput.value) keyInput.value = key;
    const reset = $('#syncResetConfig');
    if (reset) reset.hidden = !getStoredConfig();
  }

  function updateAccountText() {
    const text = $('#syncAccountText');
    if (!text || !currentSession) return;
    text.textContent = `Signed in as ${currentSession.user?.email || 'your account'}.`;
  }

  function updateAccountMeta() {
    const meta = $('#syncStatusText');
    if (!meta) return;
    const when = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'never';
    meta.textContent = `Status: ${navigator.onLine ? 'Online' : 'Offline'} · Last sync: ${when}`;
  }

  async function initSupabase() {
    if (supabase || supabaseInitStarted) return;
    supabaseInitStarted = true;
    const { url, key } = getConfig();
    if (!isConfigured()) return;

    try {
      const module = await import(SUPABASE_CDN);
      supabase = module.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (error) {
      console.warn('Focus sync: could not load Supabase.', error);
      showSection('syncSetup');
      setSyncState('error');
      return;
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      updateUI();
      if (session) startSync();
      else stopSync();
    });

    try {
      const { data } = await supabase.auth.getSession();
      currentSession = data?.session || null;
    } catch (error) {
      console.warn('Focus sync: could not read session.', error);
    }

    updateUI();
    if (currentSession) startSync();
  }

  function updateUI() {
    const configured = isConfigured();
    if (!configured) {
      showSection('syncSetup');
      populateConfigInputs();
      setSyncState('off');
      return;
    }

    if (!supabase) {
      showSection('syncLoading');
      setSyncState('off');
      initSupabase();
      return;
    }

    if (!currentSession) {
      showSection('syncSignIn');
      setSyncState('off');
      return;
    }

    showSection('syncAccount');
    updateAccountText();
    updateAccountMeta();
    setSyncState(navigator.onLine ? 'on' : 'offline');
  }

  function startSync() {
    if (syncingActive || !currentSession || !supabase) return;
    syncingActive = true;

    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        /* no-op */
      }
    }

    channel = supabase
      .channel(`focus-state-${currentSession.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'focus_state', filter: `user_id=eq.${currentSession.user.id}` },
        (payload) => {
          const row = payload?.new;
          if (row && Array.isArray(row.tasks)) handleRemote(row.tasks);
        }
      )
      .subscribe();

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    syncNow();
  }

  function stopSync() {
    syncingActive = false;
    if (channel && supabase) {
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        /* no-op */
      }
    }
    channel = null;
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibility);
  }

  function handleOnline() {
    if (currentSession) syncNow();
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible' && currentSession) syncNow();
  }

  function scheduleSync(delay = 700) {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncNow();
    }, delay);
  }

  async function push(tasks) {
    const { error } = await supabase.from('focus_state').upsert(
      {
        user_id: currentSession.user.id,
        tasks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
  }

  async function syncNow() {
    if (!currentSession || !supabase) return;
    if (isSyncing) {
      pendingSync = true;
      return;
    }

    isSyncing = true;
    setSyncState('syncing');

    try {
      const { data, error } = await supabase
        .from('focus_state')
        .select('tasks')
        .eq('user_id', currentSession.user.id)
        .maybeSingle();

      if (error) throw error;

      const remote = Array.isArray(data?.tasks) ? data.tasks : [];
      const result = window.Focus.applyRemoteTasks(remote);
      const merged = result.tasks;

      if (!data || canonical(merged) !== canonical(remote)) {
        await push(merged);
      }

      lastSyncedAt = Date.now();
      setSyncState(navigator.onLine ? 'on' : 'offline');
      updateAccountMeta();
    } catch (error) {
      console.warn('Focus sync failed.', error);
      setSyncState(navigator.onLine ? 'error' : 'offline');
      if (window.Focus) window.Focus.notify('Sync failed. Your changes are saved on this device.');
    } finally {
      isSyncing = false;
      if (pendingSync) {
        pendingSync = false;
        window.setTimeout(syncNow, 500);
      }
    }
  }

  function handleRemote(remoteTasks) {
    const result = window.Focus.applyRemoteTasks(remoteTasks);
    const merged = result.tasks;
    if (canonical(merged) !== canonical(remoteTasks)) {
      scheduleSync(400);
    }
  }

  function openDialog() {
    const dialog = $('#syncDialog');
    if (!dialog) return;
    updateUI();
    try {
      dialog.showModal();
    } catch (error) {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog() {
    const dialog = $('#syncDialog');
    if (!dialog) return;
    try {
      dialog.close();
    } catch (error) {
      dialog.removeAttribute('open');
    }
  }

  function wireEvents() {
    const openButton = $('#syncBtn');
    if (openButton) openButton.addEventListener('click', openDialog);

    const closeButton = $('#syncClose');
    if (closeButton) closeButton.addEventListener('click', closeDialog);

    const dialog = $('#syncDialog');
    if (dialog) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog();
      });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDialog();
      });
    }

    const saveConfig = $('#syncSaveConfig');
    if (saveConfig) {
      saveConfig.addEventListener('click', () => {
        const url = $('#syncUrlInput')?.value.trim() || '';
        const key = $('#syncKeyInput')?.value.trim() || '';
        const message = $('#syncConfigMsg');
        if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url) || key.length < 20) {
          if (message) message.textContent = 'Enter a valid Supabase URL and anon key.';
          return;
        }
        try {
          localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ url, key }));
        } catch (error) {
          if (message) message.textContent = 'Could not save settings in this browser.';
          return;
        }
        location.reload();
      });
    }

    const resetConfig = $('#syncResetConfig');
    if (resetConfig) {
      resetConfig.addEventListener('click', () => {
        localStorage.removeItem(CONFIG_STORAGE_KEY);
        location.reload();
      });
    }

    const sendLink = $('#syncSendLink');
    if (sendLink) {
      sendLink.addEventListener('click', async () => {
        const email = $('#syncEmailInput')?.value.trim() || '';
        const message = $('#syncAuthMsg');
        if (!email || !email.includes('@')) {
          if (message) message.textContent = 'Enter a valid email address.';
          return;
        }
        if (!supabase) await initSupabase();
        if (!supabase) {
          if (message) message.textContent = 'Sync is not ready yet.';
          return;
        }
        try {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: location.origin + location.pathname },
          });
          if (error) throw error;
          if (message) message.textContent = 'Check your inbox for the magic link.';
        } catch (error) {
          if (message) message.textContent = error?.message || 'Could not send the magic link.';
        }
      });
    }

    const syncNowButton = $('#syncNowBtn');
    if (syncNowButton) {
      syncNowButton.addEventListener('click', () => {
        syncNow();
      });
    }

    const signOutButton = $('#syncSignOutBtn');
    if (signOutButton) {
      signOutButton.addEventListener('click', async () => {
        if (!supabase) return;
        try {
          await supabase.auth.signOut();
        } catch (error) {
          console.warn('Focus sync: sign out failed.', error);
        }
        stopSync();
        currentSession = null;
        updateUI();
      });
    }

    if (window.Focus && typeof window.Focus.onChange === 'function') {
      window.Focus.onChange(() => {
        if (currentSession) scheduleSync();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireEvents, { once: true });
  } else {
    wireEvents();
  }

  // Kick off (safe no-op when unconfigured).
  if (isConfigured()) {
    initSupabase();
  } else {
    setSyncState('off');
  }
})();
