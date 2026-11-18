/* Focus — a small, dependency-free todo app. */
(() => {
  'use strict';

  const STORAGE_KEY = 'focus.todo.v1';
  const PRIORITY_LABELS = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High' };
  const PRIORITY_CLASS = { 1: 'low', 2: 'medium', 3: 'high' };
  const FILTERS = new Set(['all', 'active', 'done']);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DAY_MS = 86_400_000;
  const TOMBSTONE_MS = 30 * DAY_MS;

  const CALENDAR_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="15" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/></svg>';
  const TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7M6.4 7l.8 11.3A2 2 0 0 0 9.2 20h5.6a2 2 0 0 0 2-1.7L17.6 7"/></svg>';
  const GRIP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.6 4.6L19 7.5"/></svg>';

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) =>
    window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(value)
      : String(value).replace(/["\\]/g, '\\$&');

  const els = {
    greeting: $('#greeting'),
    dateLine: $('#dateLine'),
    ring: $('#ring'),
    ringValue: $('#ringValue'),
    list: $('#list'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    form: $('#addForm'),
    composer: $('#addForm'),
    input: $('#newTask'),
    priorityBtn: $('#priorityBtn'),
    priorityDot: $('#priorityDot'),
    priorityLabel: $('#priorityLabel'),
    priorityPopover: $('#priorityPopover'),
    dueBtn: $('#dueBtn'),
    dueLabel: $('#dueLabel'),
    duePopover: $('#duePopover'),
    dueInput: $('#dueInput'),
    filters: $('#filters'),
    clearDone: $('#clearDone'),
    itemsLeft: $('#itemsLeft'),
    themeToggle: $('#themeToggle'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastUndo: $('#toastUndo'),
    toastTimer: $('#toastTimer'),
    confetti: $('#confetti'),
  };

  /* ---------- date helpers ---------- */
  const pad = (value) => String(value).padStart(2, '0');

  function toISO(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDaysISO(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return toISO(date);
  }

  function dayDiff(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    const target = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / DAY_MS);
  }

  function formatDueShort(iso) {
    const date = new Date(`${iso}T12:00:00`);
    const options = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString(undefined, options);
  }

  function dueLabel(iso) {
    const diff = dayDiff(iso);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < -1) return `${-diff} days overdue`;
    if (diff < 7) return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
    return formatDueShort(iso);
  }

  /* ---------- state ---------- */
  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function seedTasks() {
    const now = Date.now();
    return [
      { id: uid(), text: 'Take a slow morning walk', done: true, priority: 1, due: null, createdAt: now - 3000 },
      { id: uid(), text: 'Outline the week ahead', done: false, priority: 3, due: addDaysISO(0), createdAt: now - 2000 },
      { id: uid(), text: 'Read twenty pages', done: false, priority: 2, due: addDaysISO(1), createdAt: now - 1000 },
    ].map((task, index) =>
      normalizeTask({ ...task, updatedAt: task.createdAt, deleted: false, order: index * 10 }, index)
    );
  }

  function normalizeTask(task, index = 0) {
    const createdAt = Number(task.createdAt) || Date.now();
    const order = Number(task.order);
    return {
      id: typeof task.id === 'string' && task.id ? task.id : uid(),
      text: String(task.text || '').slice(0, 200),
      done: Boolean(task.done),
      priority: [1, 2, 3].includes(task.priority) ? task.priority : 0,
      due: typeof task.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.due) ? task.due : null,
      createdAt,
      updatedAt: Number(task.updatedAt) || createdAt,
      deleted: Boolean(task.deleted),
      order: Number.isFinite(order) ? order : index * 10,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.tasks)) {
          return {
            tasks: data.tasks
              .filter((task) => task && typeof task.text === 'string' && task.text.trim())
              .map((task, index) => normalizeTask(task, index))
              .filter((task) => !task.deleted || Date.now() - task.updatedAt < TOMBSTONE_MS),
            filter: FILTERS.has(data.filter) ? data.filter : 'all',
            theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : null,
          };
        }
      }
    } catch (error) {
      console.warn('Focus: could not read saved tasks.', error);
    }
    return { tasks: seedTasks(), filter: 'all', theme: null };
  }

  const changeListeners = new Set();
  let suppressChange = false;

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, tasks: state.tasks, filter: state.filter, theme: state.theme })
      );
    } catch (error) {
      console.warn('Focus: could not save tasks.', error);
    }

    if (!suppressChange) {
      changeListeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          console.warn('Focus: change listener failed.', error);
        }
      });
    }
  }

  function onChange(listener) {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  }

  function mergeTaskArrays(localTasks, remoteTasks) {
    const merged = new Map();
    localTasks.forEach((task) => merged.set(task.id, task));
    remoteTasks.forEach((incoming) => {
      const existing = merged.get(incoming.id);
      if (!existing) {
        merged.set(incoming.id, incoming);
        return;
      }
      const localTime = Number(existing.updatedAt) || 0;
      const remoteTime = Number(incoming.updatedAt) || 0;
      if (remoteTime > localTime || (remoteTime === localTime && incoming.id > existing.id)) {
        merged.set(incoming.id, incoming);
      }
    });
    return Array.from(merged.values());
  }

  function applyRemoteTasks(remoteTasks) {
    const remote = Array.isArray(remoteTasks)
      ? remoteTasks
          .filter((task) => task && typeof task.text === 'string' && task.text.trim())
          .map((task, index) => normalizeTask(task, index))
      : [];
    const merged = mergeTaskArrays(state.tasks, remote);

    suppressChange = true;
    try {
      state.tasks = merged;
      save();
    } finally {
      suppressChange = false;
    }

    if (document.activeElement && document.activeElement.isContentEditable) {
      pendingRender = true;
    } else {
      render();
    }

    return { tasks: merged };
  }

  let state = loadState();
  let composerPriority = 0;
  let composerDue = null;
  let newTaskId = null;
  let openPopover = null;
  let toastAction = null;
  let toastTimerId = 0;
  let pendingRender = false;

  const findTask = (id) => state.tasks.find((task) => task.id === id);

  function liveTasks() {
    return state.tasks
      .filter((task) => !task.deleted)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  function visibleTasks() {
    const tasks = liveTasks();
    if (state.filter === 'active') return tasks.filter((task) => !task.done);
    if (state.filter === 'done') return tasks.filter((task) => task.done);
    return tasks;
  }

  function isAllDone() {
    const tasks = liveTasks();
    return tasks.length > 0 && tasks.every((task) => task.done);
  }

  /* ---------- rendering ---------- */
  function updateHeader() {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 5) els.greeting.textContent = 'Still awake?';
    else if (hour < 12) els.greeting.textContent = 'Good morning';
    else if (hour < 18) els.greeting.textContent = 'Good afternoon';
    else els.greeting.textContent = 'Good evening';

    els.dateLine.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  function updateProgress() {
    const tasks = liveTasks();
    const total = tasks.length;
    const done = tasks.filter((task) => task.done).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    els.ring.style.setProperty('--p', String(percent));
    els.ringValue.textContent = `${percent}%`;
    els.ring.setAttribute('aria-label', `${percent} percent complete — ${done} of ${total} tasks done`);
  }

  function updateCounts() {
    const tasks = liveTasks();
    const counts = { all: tasks.length, active: 0, done: 0 };
    tasks.forEach((task) => {
      counts[task.done ? 'done' : 'active'] += 1;
    });

    els.filters.querySelectorAll('[data-filter]').forEach((button) => {
      const filter = button.dataset.filter;
      button.setAttribute('aria-pressed', String(state.filter === filter));
      const counter = button.querySelector('[data-count]');
      if (counter) counter.textContent = String(counts[filter]);
    });

    els.clearDone.disabled = counts.done === 0;

    if (counts.active === 0) {
      els.itemsLeft.textContent = counts.all ? 'All done — nice work.' : 'Nothing here yet';
    } else {
      els.itemsLeft.textContent = counts.active === 1 ? '1 task left' : `${counts.active} tasks left`;
    }
  }

  function updateEmptyState() {
    if (liveTasks().length === 0) {
      els.emptyTitle.textContent = 'A blank slate.';
      els.emptyText.textContent = 'Add your first task above — even the smallest one counts.';
    } else if (state.filter === 'active') {
      els.emptyTitle.textContent = 'All clear.';
      els.emptyText.textContent = 'Every task is done. Take a breath, you earned it.';
    } else if (state.filter === 'done') {
      els.emptyTitle.textContent = 'Nothing finished yet.';
      els.emptyText.textContent = 'Tick something off and it will land here.';
    } else {
      els.emptyTitle.textContent = 'All clear.';
      els.emptyText.textContent = 'Nothing left on your list. Enjoy the quiet.';
    }
  }

  function makeTag(className, content, iconHTML) {
    const tag = document.createElement('span');
    tag.className = `tag ${className}`;
    if (iconHTML) tag.insertAdjacentHTML('beforeend', iconHTML);
    tag.append(content);
    return tag;
  }

  function createTaskEl(task) {
    const li = document.createElement('li');
    li.className = 'task';
    li.dataset.id = task.id;
    li.draggable = state.filter === 'all';
    if (task.done) li.classList.add('is-done');
    if (task.id === newTaskId) li.classList.add('task--new');

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(task.done));
    check.setAttribute('aria-label', `${task.done ? 'Mark as not done' : 'Mark as done'}: ${task.text}`);
    check.innerHTML = CHECK_ICON;
    check.addEventListener('click', () => toggleTask(task.id));

    const main = document.createElement('div');
    main.className = 'task__main';

    const title = document.createElement('span');
    title.className = 'task__title';
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    title.setAttribute('aria-label', `Edit task: ${task.text}`);
    title.title = 'Double-click to edit';
    title.textContent = task.text;
    title.addEventListener('dblclick', () => startEdit(title, task));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        startEdit(title, task);
      } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveTask(task.id, event.key === 'ArrowUp' ? -1 : 1);
      }
    });

    main.append(title);

    if (task.priority > 0 || task.due) {
      const meta = document.createElement('div');
      meta.className = 'task__meta';

      if (task.priority > 0) {
        const level = PRIORITY_CLASS[task.priority];
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.dataset.level = String(task.priority);
        dot.setAttribute('aria-hidden', 'true');
        const tag = makeTag(`tag--priority tag--${level}`, `${PRIORITY_LABELS[task.priority]} priority`);
        tag.prepend(dot);
        meta.append(tag);
      }

      if (task.due) {
        const diff = dayDiff(task.due);
        let modifier = '';
        if (!task.done && diff < 0) modifier = ' is-overdue';
        else if (!task.done && diff === 0) modifier = ' is-today';
        const tag = makeTag(`tag--due${modifier}`, dueLabel(task.due), CALENDAR_ICON);
        meta.append(tag);
      }

      main.append(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'task__actions';

    if (state.filter === 'all') {
      const grip = document.createElement('span');
      grip.className = 'grip';
      grip.title = 'Drag to reorder';
      grip.setAttribute('aria-hidden', 'true');
      grip.innerHTML = GRIP_ICON;
      actions.append(grip);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-btn';
    remove.setAttribute('aria-label', `Delete task: ${task.text}`);
    remove.title = 'Delete task';
    remove.innerHTML = TRASH_ICON;
    remove.addEventListener('click', () => requestDelete(task.id));
    actions.append(remove);

    li.append(check, main, actions);
    return li;
  }

  function renderList() {
    const tasks = visibleTasks();
    const fragment = document.createDocumentFragment();
    tasks.forEach((task) => fragment.append(createTaskEl(task)));
    els.list.replaceChildren(fragment);
    newTaskId = null;

    const isEmpty = tasks.length === 0;
    els.list.hidden = isEmpty;
    els.empty.hidden = !isEmpty;
    if (isEmpty) updateEmptyState();
  }

  function render() {
    updateHeader();
    updateCounts();
    updateProgress();
    renderList();
    updateComposerUI();
  }

  /* ---------- editing & mutations ---------- */
  function updateTask(id, patch) {
    const task = findTask(id);
    if (!task || task.deleted) return;
    Object.assign(task, patch, { updatedAt: Date.now() });
    save();
    render();
  }

  function setOrderFromIds(ids) {
    const byId = new Map(state.tasks.map((task) => [task.id, task]));
    const now = Date.now();
    ids.forEach((id, index) => {
      const task = byId.get(id);
      if (!task) return;
      const order = index * 10;
      if (task.order !== order) {
        task.order = order;
        task.updatedAt = now;
      }
    });
  }

  function moveTask(id, delta) {
    if (state.filter !== 'all') return;
    const tasks = liveTasks();
    const index = tasks.findIndex((task) => task.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= tasks.length) return;

    const ids = tasks.map((task) => task.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    setOrderFromIds(ids);
    save();
    render();
    const title = els.list.querySelector(`[data-id="${esc(id)}"] .task__title`);
    if (title) title.focus();
  }

  function startEdit(titleEl, task) {
    if (titleEl.isContentEditable) return;
    const original = task.text;

    try {
      titleEl.contentEditable = 'plaintext-only';
    } catch (error) {
      titleEl.contentEditable = 'true';
    }
    if (titleEl.contentEditable !== 'plaintext-only') titleEl.contentEditable = 'true';

    titleEl.classList.add('is-editing');
    titleEl.spellcheck = false;
    titleEl.focus();

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    let finished = false;

    function cleanup() {
      titleEl.removeEventListener('keydown', onKey);
      titleEl.removeEventListener('blur', onBlur);
      titleEl.contentEditable = 'false';
      titleEl.classList.remove('is-editing');
    }

    function finish(commit) {
      if (finished) return;
      finished = true;
      const next = titleEl.textContent.replace(/\s+/g, ' ').trim();
      cleanup();

      if (commit && next && next !== original) {
        updateTask(task.id, { text: next.slice(0, 200) });
      } else {
        titleEl.textContent = original;
      }
    }

    function onKey(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    }

    function onBlur() {
      finish(true);
    }

    titleEl.addEventListener('keydown', onKey);
    titleEl.addEventListener('blur', onBlur);
  }

  function toggleTask(id) {
    const task = findTask(id);
    if (!task || task.deleted) return;
    const wasAllDone = isAllDone();
    task.done = !task.done;
    task.updatedAt = Date.now();
    save();
    render();

    if (task.done) {
      const row = els.list.querySelector(`[data-id="${esc(id)}"]`);
      if (row) {
        row.classList.add('just-done');
        window.setTimeout(() => row.classList.remove('just-done'), 420);
      }
    }

    if (!wasAllDone && isAllDone()) celebrate();
  }

  /* ---------- add / delete / undo ---------- */
  function shakeComposer() {
    els.form.classList.remove('is-invalid');
    void els.form.offsetWidth;
    els.form.classList.add('is-invalid');
    window.setTimeout(() => els.form.classList.remove('is-invalid'), 460);
  }

  function addTask(event) {
    if (event) event.preventDefault();
    const text = els.input.value.replace(/\s+/g, ' ').trim();

    if (!text) {
      shakeComposer();
      els.input.focus();
      return;
    }

    const now = Date.now();
    const live = liveTasks();
    const order = live.length ? live[live.length - 1].order + 10 : 0;
    const task = {
      id: uid(),
      text: text.slice(0, 200),
      done: false,
      priority: composerPriority,
      due: composerDue,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      order,
    };

    state.tasks.push(task);
    if (state.filter === 'done') state.filter = 'all';
    newTaskId = task.id;
    save();

    els.input.value = '';
    composerPriority = 0;
    composerDue = null;
    closePopovers();
    updateComposerUI();
    render();
    els.input.focus();

    const row = els.list.querySelector(`[data-id="${esc(task.id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function requestDelete(id) {
    const row = els.list.querySelector(`[data-id="${esc(id)}"]`);
    if (!row || reduceMotion.matches) {
      commitDelete(id);
      return;
    }
    if (row.dataset.leaving === '1') return;
    row.dataset.leaving = '1';
    row.classList.add('is-leaving');
    window.setTimeout(() => commitDelete(id), 190);
  }

  function commitDelete(id) {
    const task = findTask(id);
    if (!task || task.deleted) return;

    task.deleted = true;
    task.updatedAt = Date.now();
    save();
    render();
    showToast('Task deleted', () => {
      task.deleted = false;
      task.updatedAt = Date.now();
      save();
      render();
    });
  }

  function clearCompleted() {
    const removed = liveTasks().filter((task) => task.done);
    if (!removed.length) return;

    const now = Date.now();
    removed.forEach((task) => {
      task.deleted = true;
      task.updatedAt = now;
    });
    save();
    render();

    const label = removed.length === 1 ? '1 completed task cleared' : `${removed.length} completed tasks cleared`;
    showToast(label, () => {
      const restoredAt = Date.now();
      removed.forEach((task) => {
        task.deleted = false;
        task.updatedAt = restoredAt;
      });
      save();
      render();
    });
  }

  function showToast(message, action) {
    toastAction = action;
    els.toastText.textContent = message;
    els.toastUndo.hidden = typeof action !== 'function';
    els.toast.hidden = false;
    els.toast.classList.remove('is-visible');

    els.toastTimer.style.animation = 'none';
    void els.toastTimer.offsetWidth;
    els.toastTimer.style.animation = '';

    window.requestAnimationFrame(() => els.toast.classList.add('is-visible'));
    window.clearTimeout(toastTimerId);
    toastTimerId = window.setTimeout(hideToast, 6000);
  }

  function hideToast() {
    window.clearTimeout(toastTimerId);
    els.toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!els.toast.classList.contains('is-visible')) els.toast.hidden = true;
    }, 280);
  }

  els.toastUndo.addEventListener('click', () => {
    const action = toastAction;
    hideToast();
    if (typeof action === 'function') action();
  });

  /* ---------- drag to reorder ---------- */
  let dragRow = null;

  els.list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.task');
    if (!row || state.filter !== 'all' || event.target.closest('.is-editing')) {
      event.preventDefault();
      return;
    }
    dragRow = row;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', row.dataset.id);
    } catch (error) {
      /* no-op */
    }
  });

  els.list.addEventListener('dragover', (event) => {
    if (!dragRow) return;
    event.preventDefault();
    const over = event.target.closest('.task');
    if (!over || over === dragRow) return;
    const rect = over.getBoundingClientRect();
    if (event.clientY > rect.top + rect.height / 2) over.after(dragRow);
    else over.before(dragRow);
  });

  els.list.addEventListener('drop', (event) => {
    if (dragRow) event.preventDefault();
  });

  els.list.addEventListener('dragend', () => {
    if (!dragRow) return;
    dragRow.classList.remove('is-dragging');
    dragRow = null;
    const ids = Array.from(els.list.querySelectorAll('.task')).map((row) => row.dataset.id);
    setOrderFromIds(ids);
    save();
    updateCounts();
  });

  /* ---------- composer controls ---------- */
  function composerDueLabel() {
    if (!composerDue) return 'Date';
    const diff = dayDiff(composerDue);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return formatDueShort(composerDue);
  }

  function updateComposerUI() {
    els.priorityDot.dataset.level = String(composerPriority);
    els.priorityLabel.textContent = composerPriority ? PRIORITY_LABELS[composerPriority] : 'Priority';
    els.priorityBtn.classList.toggle('is-set', composerPriority > 0);

    els.dueLabel.textContent = composerDue ? composerDueLabel() : 'Date';
    els.dueBtn.classList.toggle('is-set', Boolean(composerDue));

    els.priorityPopover.querySelectorAll('[data-level]').forEach((option) => {
      option.setAttribute('aria-pressed', String(Number(option.dataset.level) === composerPriority));
    });

    els.duePopover.querySelectorAll('[data-days]').forEach((option) => {
      const days = option.dataset.days;
      let selected = false;
      if (!composerDue) selected = days === 'none';
      else if (days !== 'none') selected = dayDiff(composerDue) === Number(days);
      option.classList.toggle('is-selected', selected);
    });
  }

  function openPanel(panel, button) {
    closePopovers();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openPopover = { panel, button };
    const first = panel.querySelector('button');
    if (first) window.requestAnimationFrame(() => first.focus());
  }

  function closePopovers() {
    if (!openPopover) return;
    const { panel, button } = openPopover;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    openPopover = null;
    if (panel.contains(document.activeElement)) button.focus();
  }

  function togglePanel(panel, button) {
    if (openPopover && openPopover.panel === panel) closePopovers();
    else openPanel(panel, button);
  }

  els.priorityBtn.addEventListener('click', () => togglePanel(els.priorityPopover, els.priorityBtn));

  els.dueBtn.addEventListener('click', () => {
    if (!openPopover || openPopover.panel !== els.duePopover) {
      els.dueInput.value = composerDue || '';
    }
    togglePanel(els.duePopover, els.dueBtn);
  });

  els.priorityPopover.addEventListener('click', (event) => {
    const option = event.target.closest('[data-level]');
    if (!option) return;
    composerPriority = Number(option.dataset.level);
    updateComposerUI();
    closePopovers();
    els.input.focus();
  });

  els.duePopover.addEventListener('click', (event) => {
    const option = event.target.closest('[data-days]');
    if (!option) return;
    const days = option.dataset.days;
    composerDue = days === 'none' ? null : addDaysISO(Number(days));
    updateComposerUI();
    closePopovers();
    els.input.focus();
  });

  els.dueInput.addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(els.dueInput.value)) composerDue = els.dueInput.value;
    updateComposerUI();
    closePopovers();
    els.input.focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!openPopover) return;
    if (openPopover.panel.contains(event.target) || openPopover.button.contains(event.target)) return;
    closePopovers();
  });

  function isTyping(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (openPopover) {
        closePopovers();
        return;
      }
      if (document.activeElement === els.input) els.input.blur();
      return;
    }
    if (
      event.key === '/' &&
      !isTyping(event.target) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      els.input.focus();
    }
  });

  /* ---------- miscellaneous ---------- */
  function celebrate() {
    if (reduceMotion.matches) return;
    const colors = ['#2f6b57', '#3f8a6f', '#d9a441', '#b45845', '#7fa9c9', '#e7d8bd'];
    for (let index = 0; index < 34; index += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti__piece';
      const angle = Math.random() * Math.PI * 2;
      const distance = 70 + Math.random() * 230;
      piece.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
      piece.style.setProperty('--y', `${Math.sin(angle) * distance - 80}px`);
      piece.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      piece.style.left = '50%';
      piece.style.top = '42%';
      piece.style.background = colors[index % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.08}s`;
      if (Math.random() > 0.5) piece.style.borderRadius = '50%';
      if (Math.random() > 0.5) piece.style.width = '6px';
      piece.addEventListener('animationend', () => piece.remove());
      els.confetti.append(piece);
    }
  }

  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.title = label;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    state.theme = theme;
    updateThemeButton();
    save();
  }

  /* ---------- wiring ---------- */
  els.form.addEventListener('submit', addTask);
  els.clearDone.addEventListener('click', clearCompleted);
  els.themeToggle.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  els.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    save();
    render();
  });

  if (document.documentElement.dataset.theme !== 'dark' && document.documentElement.dataset.theme !== 'light') {
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  updateThemeButton();
  render();
  save();

  window.Focus = {
    getTasks: () => state.tasks.map((task) => ({ ...task })),
    applyRemoteTasks,
    onChange,
    notify: (message) => showToast(message),
    refresh: render,
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  let currentDay = new Date().toDateString();
  window.setInterval(() => {
    const today = new Date().toDateString();
    const editing = document.activeElement && document.activeElement.isContentEditable;
    if (today !== currentDay && !editing) {
      currentDay = today;
      render();
    }
  }, 60_000);
})();
