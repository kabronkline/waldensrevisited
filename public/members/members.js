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
    auditor: 'Auditor',
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

// Build members sidebar - call on every members page
function initMembersSidebar(activePage) {
  const session = window.__session;
  if (!session) return;

  const isElevated = ['admin','president','secretary','treasurer','other_officer','contributor','auditor'].includes(session.role);

  const sidebarHtml = `
    <div class="sidebar-section">
      <div class="sidebar-section-title">Community</div>
      <a href="/members/" class="sidebar-link ${activePage === 'wall' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        Wall
      </a>
      <a href="/members/neighbors.html" class="sidebar-link ${activePage === 'neighbors' ? 'active' : ''}" id="neighborsSidebarLink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Neighbors <span id="neighborsBadge" class="sidebar-badge" style="display:none;"></span>
      </a>
      <a href="/members/chat.html" class="sidebar-link ${activePage === 'chat' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Chat
      </a>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-section-title">Governance</div>
      <a href="/members/documents.html" class="sidebar-link ${activePage === 'documents' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Documents
      </a>
      <a href="/governance.html" class="sidebar-link ${activePage === 'events' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Voting Events
      </a>
      <a href="/members/legal.html" class="sidebar-link ${activePage === 'legal' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v18"/><path d="M5 7l7-4 7 4"/><path d="M5 7v2l3 6H2l3-6V7"/><path d="M19 7v2l3 6h-6l3-6V7"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
        Legal
      </a>
    </div>
    ${isElevated ? `
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <div class="sidebar-section-title">Administration</div>
      <a href="/members/admin.html?tab=posts" class="sidebar-link ${activePage === 'admin-approvals' ? 'active' : ''}" id="approvalsSidebarLink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Pending Approvals <span id="approvalsBadge" class="sidebar-badge" style="display:none;"></span>
      </a>
      <a href="/members/admin.html?tab=users" class="sidebar-link ${activePage === 'admin-users' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Users
      </a>
      <a href="/members/admin.html?tab=properties" class="sidebar-link ${activePage === 'admin-properties' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Properties
      </a>
      <a href="/members/admin.html?tab=officer-chats" class="sidebar-link ${activePage === 'admin-chats' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Officer Chats
      </a>
      <a href="/members/audit.html" class="sidebar-link ${activePage === 'audit' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Audit
      </a>
      <a href="/members/admin.html?tab=system" class="sidebar-link ${activePage === 'admin-system' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Backup &amp; Restore
      </a>
    </div>` : ''}
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <a href="/members/profile.html" class="sidebar-link ${activePage === 'profile' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        My Profile
      </a>
      <a href="/auth/logout" class="sidebar-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign Out
      </a>
    </div>
  `;

  const sidebar = document.getElementById('membersSidebar');
  if (sidebar) sidebar.innerHTML = sidebarHtml;

  // Fetch neighbor invite count for badge
  fetch('/api/friends/pending-count').then(r => r.json()).then(data => {
    if (data.count > 0) {
      const badge = document.getElementById('neighborsBadge');
      if (badge) { badge.textContent = data.count; badge.style.display = ''; }
    }
  }).catch(() => {});

  // Fetch pending count for admin badge
  if (isElevated) {
    fetch('/api/admin/pending-count').then(r => r.json()).then(data => {
      if (data.total > 0) {
        const badge = document.getElementById('adminBadge');
        const appBadge = document.getElementById('approvalsBadge');
        if (badge) { badge.textContent = data.total; badge.style.display = ''; }
        if (appBadge) { appBadge.textContent = data.total; appBadge.style.display = ''; }
      }
    }).catch(() => {});
  }

  // Mobile toggle
  const toggle = document.getElementById('sidebarToggle');
  const overlay = document.getElementById('sidebarOverlay');
  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Top nav: show Members + avatar for logged-in users
  const navSignIn = document.getElementById('navSignIn');
  const navMembers = document.getElementById('navMembers');
  const navAvatar = document.getElementById('navUserAvatar');
  if (session && navSignIn && navMembers) {
    navSignIn.style.display = 'none';
    navMembers.style.display = 'flex';
    if (navAvatar) {
      if (session.profilePicture) {
        navAvatar.style.backgroundImage = 'url(' + session.profilePicture + ')';
      } else if (session.avatarId && typeof getAvatarSvg === 'function') {
        navAvatar.innerHTML = getAvatarSvg(session.avatarId);
        navAvatar.style.padding = '2px';
      } else if (session.picture) {
        navAvatar.style.backgroundImage = 'url(' + session.picture + ')';
      } else {
        const initials = (session.name || '').split(' ').map(n => n[0]).join('').toUpperCase();
        navAvatar.textContent = initials || 'U';
      }
    }
  }
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
