// SwiftDesk Frontend Utilities

const API_BASE = '/api';

// ===== AUTH HELPERS =====

function getToken() {
  return localStorage.getItem('swiftdesk_token');
}

function getUser() {
  const raw = localStorage.getItem('swiftdesk_user');
  return raw ? JSON.parse(raw) : null;
}

function setSession(token, user) {
  localStorage.setItem('swiftdesk_token', token);
  localStorage.setItem('swiftdesk_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('swiftdesk_token');
  localStorage.removeItem('swiftdesk_user');
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function redirectIfLoggedIn() {
  if (getToken()) {
    window.location.href = '/dashboard.html';
  }
}

async function logout() {
  clearSession();
  window.location.href = '/';
}

// ===== API HELPERS =====

async function apiPost(endpoint, data) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Request failed');
  return json;
}

async function apiGet(endpoint) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, { headers });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Request failed');
  return json;
}

// ===== STREAMING HELPER =====

async function streamToolResponse(endpoint, data, outputEl, onStart, onDone) {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  if (onStart) onStart();

  let fullText = '';
  outputEl.textContent = '';
  outputEl.classList.add('streaming-cursor');

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Generation failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.text) {
            fullText += parsed.text;
            outputEl.textContent = fullText;
            outputEl.scrollTop = outputEl.scrollHeight;
          }
        } catch {}
      }
    }
  } catch (err) {
    outputEl.classList.remove('streaming-cursor');
    showAlert(err.message, 'error');
    if (onDone) onDone(null);
    return;
  }

  outputEl.classList.remove('streaming-cursor');
  if (onDone) onDone(fullText);
}

// ===== UI HELPERS =====

function showAlert(message, type = 'error') {
  const existing = document.querySelector('.alert-toast');
  if (existing) existing.remove();

  const alert = document.createElement('div');
  alert.className = `alert alert-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'} alert-toast`;
  alert.style.cssText = 'position:fixed;top:80px;right:24px;z-index:9999;max-width:360px;box-shadow:0 4px 16px rgba(0,0,0,0.12)';
  alert.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span> ${message}`;
  document.body.appendChild(alert);
  setTimeout(() => alert.remove(), 4000);
}

function setButtonLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> Generating...`;
  } else {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  }).catch(() => showAlert('Failed to copy to clipboard', 'error'));
}

function initUserInfo() {
  const user = getUser();
  if (!user) return;

  const nameEls = document.querySelectorAll('[data-user-name]');
  const avatarEls = document.querySelectorAll('[data-user-avatar]');
  const planEls = document.querySelectorAll('[data-user-plan]');

  nameEls.forEach(el => { el.textContent = user.name; });
  avatarEls.forEach(el => { el.textContent = user.name.charAt(0).toUpperCase(); });
  planEls.forEach(el => { el.textContent = user.plan === 'pro' ? 'Pro Plan' : user.plan === 'enterprise' ? 'Enterprise' : 'Free Plan'; });
}

function initLogoutButtons() {
  document.querySelectorAll('[data-logout]').forEach(btn => {
    btn.addEventListener('click', logout);
  });
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) item.classList.add('active');
  });
}

// ===== AUTH FORMS =====

async function handleLogin(email, password) {
  const data = await apiPost('/auth/login', { email, password });
  setSession(data.token, data.user);
  window.location.href = '/dashboard.html';
}

async function handleRegister(name, email, password, practice) {
  const data = await apiPost('/auth/register', { name, email, password, practice });
  setSession(data.token, data.user);
  window.location.href = '/dashboard.html';
}

// ===== OUTPUT SECTION TOGGLE =====

function showOutputPanel(outputEl, placeholderEl) {
  if (placeholderEl) placeholderEl.style.display = 'none';
  outputEl.style.display = 'block';
}

function resetOutputPanel(outputEl, placeholderEl) {
  outputEl.textContent = '';
  outputEl.style.display = 'none';
  if (placeholderEl) placeholderEl.style.display = 'flex';
}
