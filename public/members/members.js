// Shared utilities for Walden's Revisited members section

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Render text with @mentions highlighted as links
function renderWithMentions(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/@(\w[\w\s]{0,30}\w)/g, '<span class="mention">@$1</span>');
}

function formatRole(role) {
  const labels = {
    pending: 'Pending',
    member: 'Member',
    contributor: 'Contributor',
    president: 'President',
    secretary: 'Secretary',
    treasurer: 'Treasurer',
    other_officer: 'Officer',
    admin: 'Admin',
  };
  return labels[role] || role;
}

function getRoleBadgeClass(role) {
  if (role === 'admin') return 'admin';
  if (['president', 'secretary', 'treasurer', 'other_officer'].includes(role)) return 'officer';
  if (role === 'contributor') return 'contributor';
  if (role === 'member') return 'member';
  return 'pending';
}

function formatTimeAgo(dateStr) {
  const date = new Date(dateStr + 'Z'); // D1 stores UTC
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showToast(message, type) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type || 'info'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// @mention autocomplete
function setupMentionAutocomplete(textareaId) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return;

  let dropdown = null;
  let searchTimeout = null;

  textarea.addEventListener('input', () => {
    const val = textarea.value;
    const cursor = textarea.selectionStart;
    const before = val.substring(0, cursor);
    const match = before.match(/@(\w*)$/);

    if (match && match[1].length >= 1) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchUsers(match[1], textarea), 250);
    } else {
      closeMentionDropdown();
    }
  });

  textarea.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.mention-item');
    const active = dropdown.querySelector('.mention-item.active');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add('active');
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      selectMention(active.dataset.name, textarea);
    } else if (e.key === 'Escape') {
      closeMentionDropdown();
    }
  });

  async function searchUsers(query) {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const users = await res.json();
      if (users.length === 0) { closeMentionDropdown(); return; }
      showMentionDropdown(users, textarea);
    } catch (e) { closeMentionDropdown(); }
  }

  function showMentionDropdown(users, textarea) {
    closeMentionDropdown();
    dropdown = document.createElement('div');
    dropdown.className = 'mention-dropdown';

    const rect = textarea.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.width = Math.min(rect.width, 300) + 'px';

    users.forEach((user, i) => {
      const item = document.createElement('div');
      item.className = 'mention-item' + (i === 0 ? ' active' : '');
      item.dataset.name = user.name;
      const pic = user.profile_picture || user.google_picture || '';
      item.innerHTML = `
        <div class="directory-avatar" style="width:28px;height:28px;">
          ${pic ? `<img src="${escapeHtml(pic)}" alt="">` : ''}
        </div>
        <span>${escapeHtml(user.name)}</span>
      `;
      item.addEventListener('click', () => selectMention(user.name, textarea));
      dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
  }

  function selectMention(name, textarea) {
    const val = textarea.value;
    const cursor = textarea.selectionStart;
    const before = val.substring(0, cursor);
    const after = val.substring(cursor);
    const atPos = before.lastIndexOf('@');
    textarea.value = before.substring(0, atPos) + '@' + name + ' ' + after;
    textarea.selectionStart = textarea.selectionEnd = atPos + name.length + 2;
    textarea.focus();
    closeMentionDropdown();
  }

  function closeMentionDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== textarea) {
      closeMentionDropdown();
    }
  });
}
