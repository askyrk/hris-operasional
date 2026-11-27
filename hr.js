var activeCompany = null;
var activeFeatures = {};
var hrCache = { employees: [], locations: [], bpjs: [], attendance: [], requests: [], monthlyRaw: [], monthlySummary: [] };
var toastTimer = null;

var PAGE_FEATURE_MAP = {
  pres: 'people_presensi',
  req: 'people_pengajuan',
  bpjs: 'people_bpjs'
};

window.onload = function() {
  if (localStorage.getItem('hris_dark') === '1') {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  }
  detectTenant();
  var today = getTodayWIB();
  document.getElementById('filter-date').value = today;
  document.getElementById('filter-month').value = today.slice(0, 7);
  loadBranding();
  checkHrSession();
};

function hasFeature(key) { return !!(activeFeatures && activeFeatures[key] === true); }

function applyFeatureVisibility() {
  document.querySelectorAll('[data-feature]').forEach(function(el) {
    el.classList.toggle('hidden', !hasFeature(el.getAttribute('data-feature')));
  });
}

function getInitials(name) {
  var words = String(name || 'VP').trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || 'VP').slice(0, 2).toUpperCase();
}

function formatIndoDate(ymd) {
  if (!ymd) return '-';
  var d = new Date(ymd + 'T00:00:00');
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toggleTheme() {
  var html = document.documentElement;
  var toDark = !html.classList.contains('dark');
  html.classList.toggle('dark', toDark);
  html.classList.toggle('light', !toDark);
  localStorage.setItem('hris_dark', toDark ? '1' : '0');
}

function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('-translate-x-full');
  document.getElementById('sidebar-backdrop').classList.toggle('hidden');
}

function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  var dot = el.querySelector('span');
  document.getElementById('toast-msg').textContent = msg;
  if (dot) dot.className = 'w-2 h-2 rounded-full ' + (isErr ? 'bg-rose-500' : 'bg-emerald-400 dark:bg-emerald-600');
  el.classList.remove('translate-y-16', 'opacity-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.add('translate-y-16', 'opacity-0'); }, 2800);
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  var bg = document.getElementById('modal-bg');
  bg.classList.remove('hidden');
  bg.classList.add('flex');
}

function closeModal() {
  var bg = document.getElementById('modal-bg');
  bg.classList.add('hidden');
  bg.classList.remove('flex');
}

function showLoginErr(msg) {
  var el = document.getElementById('login-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function applyBranding(b, customWhiteLabel) {
  if (!b) return;
  if (b.primary_color) document.documentElement.style.setProperty('--primary', b.primary_color);
  var compName = b.company_name || 'Veropsa People';
  var init = getInitials(compName);
  document.title = 'Portal HRIS — ' + compName;
  ['login-company', 'hr-company', 'hr-mobile-title'].forEach(function(id) { document.getElementById(id).textContent = compName; });
  document.getElementById('hr-brand-kicker').textContent = customWhiteLabel ? 'PORTAL HRIS' : 'VEROPSA PEOPLE';

  var logoUrl = (b.logo_url || '').trim();
  [['login-logo', 'login-initials'], ['hr-logo', 'hr-initials']].forEach(function(pair) {
    var img = document.getElementById(pair[0]);
    var box = document.getElementById(pair[1]);
    box.textContent = init;
    if (logoUrl) {
      img.src = logoUrl;
      img.classList.remove('hidden');
      box.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      box.classList.remove('hidden');
    }
  });
}

function loadBranding() {
  sb.rpc('hris_get_public_branding', { p_slug: tenantContext.slug, p_domain: tenantContext.domain }).then(function(r) {
    if (r.data && r.data.ok) {
      if (!tenantContext.slug && r.data.slug) tenantContext.slug = r.data.slug;
      applyBranding(r.data, r.data.custom_whitelabel);
    }
  });
}

function checkHrSession() {
  sb.auth.getSession().then(function(res) {
    if (res.data && res.data.session) openHrDashboard(res.data.session.user);
  });
}

function handleHrLogin(e) {
  e.preventDefault();
  document.getElementById('login-msg').classList.add('hidden');
  var btn = document.getElementById('btn-hr-login');
  btn.disabled = true; btn.textContent = 'Memeriksa...';
  sb.auth.signInWithPassword({
    email: document.getElementById('hr-email').value.trim(),
    password: document.getElementById('hr-pass').value
  }).then(function(res) {
    btn.disabled = false; btn.textContent = 'MASUK';
    if (res.error) { showLoginErr(res.error.message); return; }
    openHrDashboard(res.data.user);
  });
}

function openHrDashboard(user) {
  document.getElementById('hr-user-email').textContent = user.email;
  sb.from('user_roles').select('role, company_id').eq('user_id', user.id).then(function(r) {
    var roles = (r.data || []).filter(function(x) { return !!x.company_id; });
    if (!roles.length) {
      showLoginErr('Akun Anda belum terhubung ke perusahaan operasional mana pun.');
      sb.auth.signOut();
      return;
    }
    var myCompIds = roles.map(function(x) { return x.company_id; });
    sb.from('companies').select('*').in('id', myCompIds).then(function(cRes) {
      var myComps = cRes.data || [];
      if (!myComps.length) { showLoginErr('Data perusahaan tidak ditemukan.'); return; }
      var picked = (tenantContext.slug ? myComps.find(function(c) { return c.slug === tenantContext.slug; }) : null) || myComps[0];
      document.getElementById('view-login').classList.add('hidden');
      document.getElementById('view-hr').classList.remove('hidden');
      setActiveCompany(picked);
    });
  });
}

function setActiveCompany(comp) {
  activeCompany = comp;
  activeFeatures = comp.features || {};
  tenantContext.slug = comp.slug;
  applyBranding(comp.branding || {}, hasFeature('custom_whitelabel'));
  applyFeatureVisibility();
  showHrPage('dash', document.getElementById('nav-dash'));

  var b = comp.branding || {}, integ = comp.integrations || {};
  document.getElementById('s-comp').value = b.company_name || '';
  document.getElementById('s-sub').value = b.app_subtitle || '';
  document.getElementById('s-logo').value = b.logo_url || '';
  document.getElementById('s-col').value = b.primary_color || '#EA580C';
  document.getElementById('s-drv').value = integ.people_drive_webhook || '';
  document.getElementById('s-drv-sec').value = integ.people_drive_secret || '';
  document.getElementById('s-wa').value = b.admin_wa || '';

  loadHrData();
}

function showHrPage(id, btn) {
  var reqFlag = PAGE_FEATURE_MAP[id];
  if (reqFlag && !hasFeature(reqFlag)) {
    showToast('Modul ini belum aktif untuk perusahaan Anda.', true);
    id = 'dash';
    btn = document.getElementById('nav-dash');
  }
  ['dash', 'pres', 'req', 'bpjs', 'emp', 'loc', 'set'].forEach(function(p) {
    document.getElementById('page-' + p).classList.toggle('hidden', p !== id);
  });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('sidebar-backdrop').classList.add('hidden');
}

function switchPresTab(tab) {
  if (tab === 'bulanan' && !hasFeature('people_rekap_bulanan')) {
    showToast('Fitur Rekap Bulanan belum aktif.', true);
    return;
  }
  var activeCls = ['bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm', 'font-semibold'];
  var inactCls = ['text-slate-600', 'dark:text-slate-400', 'font-medium'];
  var th = document.getElementById('stab-harian');
  var tb = document.getElementById('stab-bulanan');

  if (tab === 'harian') {
    th.classList.add.apply(th.classList, activeCls); th.classList.remove.apply(th.classList, inactCls);
    tb.classList.remove.apply(tb.classList, activeCls); tb.classList.add.apply(tb.classList, inactCls);
  } else {
    tb.classList.add.apply(tb.classList, activeCls); tb.classList.remove.apply(tb.classList, inactCls);
    th.classList.remove.apply(th.classList, activeCls); th.classList.add.apply(th.classList, inactCls);
  }
  document.getElementById('pres-harian').classList.toggle('hidden', tab !== 'harian');
  document.getElementById('pres-bulanan').classList.toggle('hidden', tab !== 'bulanan');
  document.getElementById('pres-head-actions-harian').classList.toggle('hidden', tab !== 'harian');
  document.getElementById('pres-head-actions-bulanan').classList.toggle('hidden', tab !== 'bulanan');
  if (tab === 'bulanan') loadMonthlyRecap();
}

function logoutHr() {
  sb.auth.signOut().then(function() { location.reload(); });
}

function loadHrData(notify) {
  if (!activeCompany) return;
  var cid = activeCompany.id;
  Promise.all([
    sb.from('hris_locations').select('*').eq('company_id', cid).order('kota'),
    sb.from('hris_employees').select('*, hris_locations(nama_lokasi, kota)').eq('company_id', cid).order('nama_lengkap'),
    sb.from('hris_bpjs').select('*, hris_employees(id, nik_karyawan, nama_lengkap, nik_ktp, no_kk, status_kerja, location_id)').eq('company_id', cid),
    sb.from('hris_requests').select('*, hris_employees(nik_karyawan, nama_lengkap)').eq('company_id', cid).order('created_at', { ascending: false })
  ]).then(function(r) {
    hrCache.locations = r[0].data || [];
    hrCache.employees = r[1].data || [];
    hrCache.bpjs = r[2].data || [];
    hrCache.requests = r[3].data || [];
    renderLocations(); renderEmployees(); renderBpjs(); renderRequests(); loadAttendance();
    if (notify) showToast('Data dashboard diperbarui');
  });
}

// ===== BADGES & HELPER TAMPILAN =====
function badgeStatus(st) {
  var map = {
    AKTIF: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/20',
    HADIR: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/20',
    DISETUJUI: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-500/20',
    DINAS_LUAR: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200/70 dark:border-blue-500/20',
    CUTI: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300 border-teal-200/70 dark:border-teal-500/20',
    IZIN: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/20',
    PROSES_DAFTAR: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/20',
    PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200/70 dark:border-amber-500/20',
    SAKIT: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300 border-purple-200/70 dark:border-purple-500/20',
    PERLU_NONAKTIF: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/20',
    BELUM_DAFTAR: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/20',
    DITOLAK: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border-rose-200/70 dark:border-rose-500/20'
  };
  var cls = map[st] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ' + cls + '">' + esc(String(st || '-').replace(/_/g, ' ')) + '</span>';
}

function badgeFace(st) {
  if (st === 'VERIFIED') return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">COCOK</span>';
  if (st === 'ENROLLED') return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">TERDAFTAR</span>';
  if (st === 'MISMATCH') return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">TIDAK COCOK</span>';
  if (st === 'NO_FACE') return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">TANPA WAJAH</span>';
  if (st === 'TIMEOUT') return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">CEK MANUAL</span>';
  return '<span class="text-slate-300 dark:text-slate-600">—</span>';
}

function isFaceWarn(a) {
  if (isNonWorkStatus(a.status)) return false;
  var fm = a.face_status_masuk || a.face_status;
  var fp = a.face_status_pulang;
  return (fm === 'MISMATCH' || fm === 'NO_FACE' || fm === 'TIMEOUT' || fp === 'MISMATCH' || fp === 'NO_FACE' || fp === 'TIMEOUT');
}

function formatFaceCell(a) {
  if (isNonWorkStatus(a.status)) return '<span class="text-slate-300 dark:text-slate-600">—</span>';
  var fm = a.face_status_masuk || a.face_status;
  var fp = a.face_status_pulang;
  var lines = [];
  if (a.jam_masuk && fm && fm !== 'DISABLED') lines.push('<div class="mb-1"><span class="text-[10px] font-mono text-slate-400 mr-1">M:</span>' + badgeFace(fm) + '</div>');
  if (a.jam_pulang && fp && fp !== 'DISABLED') lines.push('<div><span class="text-[10px] font-mono text-slate-400 mr-1">P:</span>' + badgeFace(fp) + '</div>');
  return lines.length ? lines.join('') : '<span class="text-slate-300 dark:text-slate-600">—</span>';
}

function formatPulangCell(a, isShift24) {
  if (isNonWorkStatus(a.status)) return '<span class="text-slate-300 dark:text-slate-600">—</span>';
  if (a.jam_pulang) {
    if (!a.jam_masuk) return formatTimeWIB(a.jam_pulang);
    return formatTimeWIB(a.jam_pulang) + (getDateWIB(a.jam_pulang) !== getDateWIB(a.jam_masuk) ? ' <span class="text-[10px] text-amber-600">(+1 hr)</span>' : '');
  }
  if (isLupaPulang(a, isShift24)) return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">LUPA PULANG</span>';
  return '<span class="text-xs text-slate-400">Sedang kerja</span>';
}

// ===== 02 / PRESENSI HARIAN & REKAP =====
function loadAttendance() {
  if (!activeCompany) return;
  var tgl = document.getElementById('filter-date').value || getTodayWIB();
  sb.from('hris_attendance')
    .select('*, hris_locations(nama_lokasi), hris_employees(nik_karyawan, nik_ktp, nama_lengkap, jabatan, location_id, is_shift_24h, hris_locations(nama_lokasi))')
    .eq('company_id', activeCompany.id)
    .eq('tanggal', tgl)
    .order('created_at', { ascending: false })
    .then(function(res) {
      hrCache.attendance = res.data || [];
      if (tgl === getTodayWIB()) document.getElementById('k-hadir').textContent = hrCache.attendance.length;
      renderAttendanceTable();
    });
}

function renderAttendanceTable() {
  var tgl = document.getElementById('filter-date').value || getTodayWIB();
  var q = (document.getElementById('search-pres').value || '').toLowerCase();
  var locId = document.getElementById('filter-pres-loc').value;
  var anomali = document.getElementById('filter-pres-anomali').value;
  var dash = '<span class="text-slate-300 dark:text-slate-600">—</span>';

  document.getElementById('active-date-badge').textContent = formatIndoDate(tgl);

  var locRows = hrCache.attendance.filter(function(a) {
    var emp = a.hris_employees || {};
    var actualLocId = a.location_id || emp.location_id;
    return !locId || actualLocId === locId;
  });

  var kHadir = 0, kDl = 0, kNon = 0;
  locRows.forEach(function(a) {
    if (a.status === 'DINAS_LUAR') kDl++;
    else if (isNonWorkStatus(a.status)) kNon++;
    else kHadir++;
  });
  document.getElementById('kpi-h-hadir').textContent = kHadir;
  document.getElementById('kpi-h-dl').textContent = kDl;
  document.getElementById('kpi-h-non').textContent = kNon;

  var rows = locRows.filter(function(a) {
    var emp = a.hris_employees || {};
    var matchQ = !q || (emp.nama_lengkap || '').toLowerCase().indexOf(q) !== -1 || (emp.nik_ktp || emp.nik_karyawan || '').indexOf(q) !== -1;
    if (!matchQ) return false;
    if (anomali === 'LUPA_PULANG') return isLupaPulang(a, !!emp.is_shift_24h);
    if (anomali === 'FACE_WARN') return isFaceWarn(a);
    if (anomali === 'DINAS_LUAR') return a.status === 'DINAS_LUAR';
    if (anomali === 'NON_HADIR') return isNonWorkStatus(a.status);
    return true;
  });

  var html = '';
  rows.forEach(function(a) {
    var emp = a.hris_employees || {};
    var loc = (a.hris_locations && a.hris_locations.nama_lokasi)
      ? a.hris_locations.nama_lokasi
      : ((emp.hris_locations && emp.hris_locations.nama_lokasi) ? emp.hris_locations.nama_lokasi : '-');
    var st = (a.status === 'TERLAMBAT') ? 'HADIR' : a.status;
    var foto = (a.foto_masuk_url ? '<a href="' + a.foto_masuk_url + '" target="_blank" class="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline mr-2">' + (isNonWorkStatus(st) ? 'Bukti' : 'Masuk') + '</a>' : '') +
               (a.foto_pulang_url ? '<a href="' + a.foto_pulang_url + '" target="_blank" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">Pulang</a>' : '');
    html += '<tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-4"><div class="flex items-center gap-3">' +
        '<div class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs flex items-center justify-center shrink-0 border border-slate-200/70 dark:border-slate-700">' + getInitials(emp.nama_lengkap) + '</div>' +
        '<div><p class="font-semibold leading-snug">' + esc(emp.nama_lengkap || '-') + '</p><p class="text-xs text-slate-500">' + esc(emp.jabatan || emp.nik_ktp || emp.nik_karyawan || '-') + '</p></div>' +
      '</div></td>' +
      '<td class="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">' + esc(loc) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs tabular-nums">' + (a.jam_masuk ? formatTimeWIB(a.jam_masuk) : dash) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs tabular-nums">' + formatPulangCell(a, !!emp.is_shift_24h) + '</td>' +
      '<td class="py-3 px-4 whitespace-nowrap">' + badgeStatus(st) + '</td>' +
      '<td class="py-3 px-4 whitespace-nowrap">' + formatFaceCell(a) + '</td>' +
      '<td class="py-3 px-4 text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">' + (a.keterangan ? esc(a.keterangan) : dash) + '</td>' +
      '<td class="py-3 px-4 whitespace-nowrap">' + (foto || dash) + '</td>' +
      '<td class="py-3 px-4 text-right whitespace-nowrap"><div class="inline-flex items-center gap-1.5">' +
        '<button onclick="openAttModal(\'' + a.id + '\')" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">Koreksi</button>' +
        '<button onclick="deleteAttendance(\'' + a.id + '\')" title="Hapus" class="px-2 py-1 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">✕</button>' +
      '</div></td></tr>';
  });

  document.getElementById('absen-body').innerHTML = html || '<tr><td colspan="9" class="py-8 px-4 text-center text-sm text-slate-400">Tidak ada data presensi sesuai filter.</td></tr>';
  document.getElementById('table-count-info').textContent = 'Menampilkan ' + rows.length + ' dari ' + locRows.length + ' catatan presensi';
  renderMissingAttendance();
}

function renderMissingAttendance() {
  var tgl = document.getElementById('filter-date').value || getTodayWIB();
  var tglLabel = formatIndoDate(tgl);
  var locId = document.getElementById('filter-pres-loc').value;

  var presentMap = {};
  hrCache.attendance.forEach(function(a) { presentMap[a.employee_id] = true; });

  var missing = hrCache.employees.filter(function(e) {
    return e.status_kerja === 'AKTIF' && !presentMap[e.id] && (!locId || e.location_id === locId);
  });

  document.getElementById('kpi-h-belum').textContent = missing.length;
  document.getElementById('kpi-h-belum-dot').className = 'w-2 h-2 rounded-full ' + (missing.length > 0 ? 'bg-amber-500' : 'bg-emerald-500');
  document.getElementById('belum-date-zero').textContent = tglLabel;
  document.getElementById('belum-date-active').textContent = tglLabel;

  var card = document.getElementById('belum-card');
  if (missing.length === 0) {
    document.getElementById('belum-state-zero').classList.remove('hidden');
    document.getElementById('belum-state-active').classList.add('hidden');
    card.className = 'rounded-2xl border transition-all overflow-hidden bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/50';
    return;
  }

  document.getElementById('belum-state-zero').classList.add('hidden');
  document.getElementById('belum-state-active').classList.remove('hidden');
  card.className = 'rounded-2xl border transition-all overflow-hidden bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/50';
  document.getElementById('belum-count-badge').textContent = missing.length + ' orang';

  var html = '';
  missing.forEach(function(e) {
    var loc = e.hris_locations ? (e.hris_locations.nama_lokasi + ' (' + e.hris_locations.kota + ')') : '-';
    var wa = formatWaNumber(e.no_hp);
    var waBtn = wa.length >= 9
      ? '<a href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Halo ' + e.nama_lengkap + ', pengingat untuk segera melakukan presensi hari ini (' + tglLabel + '). Terima kasih.') + '" target="_blank" class="px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/15 mr-1.5">Ingatkan WA</a>'
      : '';
    html += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-semibold">' + esc(e.nama_lengkap) + '</td>' +
      '<td class="py-3 px-4 text-slate-600 dark:text-slate-400">' + esc(e.jabatan || '-') + '</td>' +
      '<td class="py-3 px-4 text-slate-600 dark:text-slate-400">' + esc(loc) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs text-slate-500">' + esc(e.no_hp || '-') + '</td>' +
      '<td class="py-3 px-4 text-right whitespace-nowrap">' + waBtn +
        '<button onclick="openManualAttModal(\'' + e.id + '\')" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">+ Input Manual</button>' +
      '</td></tr>';
  });
  document.getElementById('missing-body').innerHTML = html;
}

// ===== INPUT MANUAL & KOREKSI PRESENSI =====
var INP_CLS = 'w-full px-3 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-slate-400';
var LBL_CLS = 'block text-xs font-medium text-slate-500 mb-1';

function openManualAttModal(preEmpId) {
  var tgl = document.getElementById('filter-date').value || getTodayWIB();
  var activeEmps = hrCache.employees.filter(function(e) { return e.status_kerja === 'AKTIF'; });
  if (!activeEmps.length) { showToast('Belum ada karyawan aktif.', true); return; }

  var empOpts = activeEmps.map(function(e) {
    var loc = e.hris_locations ? (' — ' + e.hris_locations.nama_lokasi) : '';
    return '<option value="' + e.id + '" ' + (preEmpId === e.id ? 'selected' : '') + '>' + esc(e.nama_lengkap) + esc(loc) + '</option>';
  }).join('');
  var locOpts = '<option value="">-- Sesuai Penempatan Utama --</option>' + hrCache.locations.map(function(l) {
    return '<option value="' + l.id + '">' + esc(l.nama_lokasi) + ' (' + esc(l.kota) + ')</option>';
  }).join('');

  openModal(
    '<div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800"><h3 class="text-base font-bold">+ Input Presensi Manual</h3><button onclick="closeModal()" class="p-1 text-slate-400 hover:text-slate-600">✕</button></div>' +
    '<form onsubmit="saveManualAttModal(event)" class="space-y-4">' +
      '<div><label class="' + LBL_CLS + '">Pilih Karyawan</label><select id="mn-emp" required class="' + INP_CLS + '">' + empOpts + '</select></div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="' + LBL_CLS + '">Status Kehadiran</label><select id="mn-st" onchange="onManualStChange()" class="' + INP_CLS + '"><option value="HADIR">HADIR</option><option value="DINAS_LUAR">DINAS LUAR</option><option value="IZIN">IZIN</option><option value="CUTI">CUTI</option><option value="SAKIT">SAKIT</option></select></div>' +
        '<div><label class="' + LBL_CLS + '">Lokasi Aktual</label><select id="mn-loc" class="' + INP_CLS + '">' + locOpts + '</select></div>' +
        '<div><label id="mn-tgl-lbl" class="' + LBL_CLS + '">Tanggal</label><input type="date" id="mn-tgl" value="' + tgl + '" onchange="syncManualEndDate()" required class="' + INP_CLS + '" /></div>' +
        '<div id="mn-tgl-end-wrap" class="hidden"><label class="' + LBL_CLS + '">Sampai Tanggal (Multi-Hari)</label><input type="date" id="mn-tgl-end" value="' + tgl + '" class="' + INP_CLS + '" /></div>' +
      '</div>' +
      '<div id="mn-time-wrap" class="space-y-3">' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<div><label class="' + LBL_CLS + '">Jam Masuk (WIB)</label><input type="time" id="mn-in" value="07:00" class="' + INP_CLS + ' font-mono" /></div>' +
          '<div><label class="' + LBL_CLS + '">Jam Pulang (WIB)</label><input type="time" id="mn-out" value="16:00" class="' + INP_CLS + ' font-mono" /></div>' +
        '</div>' +
        '<label class="inline-flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="mn-nextday" /> Jam pulang lewat tengah malam (+1 hari / shift 24 jam)</label>' +
      '</div>' +
      '<div><label class="' + LBL_CLS + '">Keterangan</label><input id="mn-ket" placeholder="Contoh: Input manual HR / Izin via WA" class="' + INP_CLS + '" /></div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Batal</button><button type="submit" id="btn-mn-save" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900">Simpan Presensi</button></div>' +
    '</form>'
  );
}

function onManualStChange() {
  var nonWork = isNonWorkStatus(document.getElementById('mn-st').value);
  document.getElementById('mn-time-wrap').classList.toggle('hidden', nonWork);
  document.getElementById('mn-tgl-end-wrap').classList.toggle('hidden', !nonWork);
  document.getElementById('mn-tgl-lbl').textContent = nonWork ? 'Dari Tanggal' : 'Tanggal';
}

function syncManualEndDate() {
  var s = document.getElementById('mn-tgl').value;
  var eEl = document.getElementById('mn-tgl-end');
  if (s && (!eEl.value || eEl.value < s)) eEl.value = s;
}

function saveManualAttModal(ev) {
  ev.preventDefault();
  var empId = document.getElementById('mn-emp').value;
  var emp = hrCache.employees.find(function(x) { return x.id === empId; });
  var st = document.getElementById('mn-st').value;
  var locId = document.getElementById('mn-loc').value || (emp ? emp.location_id : null);
  var tglStart = document.getElementById('mn-tgl').value;
  var tglEnd = isNonWorkStatus(st) ? (document.getElementById('mn-tgl-end').value || tglStart) : tglStart;
  if (tglEnd < tglStart) { showToast('Tanggal selesai tidak boleh lebih awal.', true); return; }
  if (countDaysInclusive(tglStart, tglEnd) > 31) { showToast('Maksimal input sekaligus 31 hari.', true); return; }

  var jamIn = document.getElementById('mn-in').value;
  var jamOut = document.getElementById('mn-out').value;
  var nextDay = document.getElementById('mn-nextday').checked;
  var ket = document.getElementById('mn-ket').value.trim() || ('[INPUT HR] ' + st);

  var rows = [], d = tglStart;
  while (d <= tglEnd) {
    rows.push({
      company_id: activeCompany.id, employee_id: empId, location_id: locId, tanggal: d, status: st,
      jam_masuk: (isNonWorkStatus(st) || !jamIn) ? null : (d + 'T' + jamIn + ':00+07:00'),
      jam_pulang: (isNonWorkStatus(st) || !jamOut) ? null : ((nextDay ? addDaysStr(d, 1) : d) + 'T' + jamOut + ':00+07:00'),
      keterangan: ket, face_status: 'DISABLED', face_status_masuk: 'DISABLED'
    });
    d = addDaysStr(d, 1);
  }

  var btn = document.getElementById('btn-mn-save');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  sb.from('hris_attendance').insert(rows).then(function(r) {
    btn.disabled = false; btn.textContent = 'Simpan Presensi';
    if (r.error) showToast('Gagal: ' + r.error.message, true);
    else { closeModal(); loadAttendance(); showToast('Presensi manual disimpan'); }
  });
}

function openAttModal(attId) {
  var a = hrCache.attendance.find(function(x) { return x.id === attId; });
  if (!a) return;
  var emp = a.hris_employees || {};
  var st = (a.status === 'TERLAMBAT') ? 'HADIR' : a.status;
  var isNextDay = !!(a.jam_pulang && a.tanggal && getDateWIB(a.jam_pulang) > a.tanggal);
  var locOpts = '<option value="">-- Sesuai Penempatan Utama --</option>' + hrCache.locations.map(function(l) {
    return '<option value="' + l.id + '" ' + (a.location_id === l.id ? 'selected' : '') + '>' + esc(l.nama_lokasi) + ' (' + esc(l.kota) + ')</option>';
  }).join('');
  var stOpts = ['HADIR', 'DINAS_LUAR', 'IZIN', 'CUTI', 'SAKIT'].map(function(o) {
    return '<option value="' + o + '" ' + (st === o ? 'selected' : '') + '>' + o.replace('_', ' ') + '</option>';
  }).join('');

  openModal(
    '<div class="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800"><h3 class="text-base font-bold">Koreksi Presensi — ' + esc(emp.nama_lengkap || '-') + '</h3><button onclick="closeModal()" class="p-1 text-slate-400">✕</button></div>' +
    '<p class="text-xs text-slate-500 mb-4">Tanggal: <strong class="font-mono">' + esc(a.tanggal) + '</strong></p>' +
    '<form onsubmit="saveAttModal(event,\'' + a.id + '\',\'' + esc(a.tanggal) + '\')" class="space-y-4">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="' + LBL_CLS + '">Status</label><select id="ma-st" class="' + INP_CLS + '">' + stOpts + '</select></div>' +
        '<div><label class="' + LBL_CLS + '">Lokasi Aktual</label><select id="ma-loc" class="' + INP_CLS + '">' + locOpts + '</select></div>' +
        '<div><label class="' + LBL_CLS + '">Jam Masuk (WIB)</label><input type="time" id="ma-in" value="' + getHHMMWIB(a.jam_masuk) + '" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Jam Pulang (WIB)</label><input type="time" id="ma-out" value="' + getHHMMWIB(a.jam_pulang) + '" class="' + INP_CLS + ' font-mono" /></div>' +
      '</div>' +
      '<label class="inline-flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="ma-nextday" ' + (isNextDay ? 'checked' : '') + ' /> Jam pulang lewat tengah malam (+1 hari / shift 24 jam)</label>' +
      '<div><label class="' + LBL_CLS + '">Keterangan</label><input id="ma-ket" value="' + esc(a.keterangan || '') + '" class="' + INP_CLS + '" /></div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300">Batal</button><button type="submit" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900">Simpan Koreksi</button></div>' +
    '</form>'
  );
}

function saveAttModal(ev, id, tgl) {
  ev.preventDefault();
  var st = document.getElementById('ma-st').value;
  var jamIn = document.getElementById('ma-in').value;
  var jamOut = document.getElementById('ma-out').value;
  var nextDay = document.getElementById('ma-nextday').checked;
  sb.from('hris_attendance').update({
    status: st,
    location_id: document.getElementById('ma-loc').value || null,
    jam_masuk: (isNonWorkStatus(st) || !jamIn) ? null : (tgl + 'T' + jamIn + ':00+07:00'),
    jam_pulang: (isNonWorkStatus(st) || !jamOut) ? null : ((nextDay ? addDaysStr(tgl, 1) : tgl) + 'T' + jamOut + ':00+07:00'),
    keterangan: document.getElementById('ma-ket').value.trim()
  }).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast('Gagal: ' + r.error.message, true);
    else { closeModal(); loadAttendance(); showToast('Presensi dikoreksi'); }
  });
}

function deleteAttendance(id) {
  if (!confirm('Hapus permanen data presensi ini?')) return;
  sb.from('hris_attendance').delete().eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast('Gagal hapus: ' + r.error.message, true);
    else { loadAttendance(); showToast('Catatan presensi dihapus'); }
  });
}

// ===== REKAP BULANAN & EXPORT MATRIKS EXCEL (.XLSX) =====
function loadMonthlyRecap() {
  if (!activeCompany || !hasFeature('people_rekap_bulanan')) return;
  var ym = document.getElementById('filter-month').value || getTodayWIB().slice(0, 7);
  var parts = ym.split('-');
  var lastDay = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 0).getDate();
  var prevDate = addDaysStr(ym + '-01', -1);
  var endDate = ym + '-' + String(lastDay).padStart(2, '0');
  document.getElementById('recap-body').innerHTML = '<tr><td colspan="10" class="py-6 px-4 text-slate-400">Menghitung rekap bulan ' + ym + '...</td></tr>';
  sb.from('hris_attendance')
    .select('employee_id, tanggal, jam_masuk, jam_pulang, status, foto_masuk_url, foto_pulang_url')
    .eq('company_id', activeCompany.id)
    .gte('tanggal', prevDate).lte('tanggal', endDate)
    .order('jam_masuk', { ascending: true })
    .then(function(res) {
      hrCache.monthlyRaw = res.data || [];
      renderMonthlyRecap();
    });
}

function renderMonthlyRecap() {
  var ym = document.getElementById('filter-month').value || getTodayWIB().slice(0, 7);
  var locId = document.getElementById('filter-recap-loc').value;
  var emp24Map = {};
  hrCache.employees.forEach(function(e) { emp24Map[e.id] = !!e.is_shift_24h; });

  var map = {};
  hrCache.monthlyRaw.forEach(function(a) {
    if (!a.tanggal || a.tanggal.indexOf(ym) !== 0) return;
    if (!map[a.employee_id]) map[a.employee_id] = { hadir: 0, dl: 0, izin: 0, cuti: 0, sakit: 0, lupa: 0 };
    var m = map[a.employee_id];
    if (a.status === 'DINAS_LUAR') m.dl++;
    else if (a.status === 'IZIN') m.izin++;
    else if (a.status === 'CUTI') m.cuti++;
    else if (a.status === 'SAKIT') m.sakit++;
    else m.hadir++;
    if (isLupaPulang(a, emp24Map[a.employee_id])) m.lupa++;
  });

  var list = hrCache.employees.filter(function(e) { return e.status_kerja === 'AKTIF' && (!locId || e.location_id === locId); });
  hrCache.monthlySummary = [];
  var html = '';
  list.forEach(function(e) {
    var m = map[e.id] || { hadir: 0, dl: 0, izin: 0, cuti: 0, sakit: 0, lupa: 0 };
    var total = m.hadir + m.dl;
    var loc = e.hris_locations ? e.hris_locations.nama_lokasi : '-';
    hrCache.monthlySummary.push({ nik: e.nik_ktp || e.nik_karyawan, nama: e.nama_lengkap, loc: loc, hadir: m.hadir, dl: m.dl, izin: m.izin, cuti: m.cuti, sakit: m.sakit, lupa: m.lupa, total: total });
    html += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-mono text-xs">' + esc(e.nik_ktp || e.nik_karyawan) + '</td>' +
      '<td class="py-3 px-4 font-semibold">' + esc(e.nama_lengkap) + '</td>' +
      '<td class="py-3 px-4 text-slate-600 dark:text-slate-400">' + esc(loc) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + m.hadir + '</td><td class="py-3 px-4 font-mono text-xs">' + m.dl + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + m.izin + '</td><td class="py-3 px-4 font-mono text-xs">' + m.cuti + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + m.sakit + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + (m.lupa > 0 ? '<span class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 font-bold">' + m.lupa + '</span>' : '0') + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs font-bold">' + total + '</td></tr>';
  });
  document.getElementById('recap-body').innerHTML = html || '<tr><td colspan="10" class="py-6 px-4 text-center text-slate-400">Tidak ada karyawan aktif di lokasi ini.</td></tr>';
}

function exportMonthlyMatrixXLSX() {
  if (typeof XLSX === 'undefined') { showToast('Library Excel belum termuat.', true); return; }
  var ym = document.getElementById('filter-month').value || getTodayWIB().slice(0, 7);
  var locId = document.getElementById('filter-recap-loc').value;
  var locObj = hrCache.locations.find(function(l) { return l.id === locId; });
  var locTag = locObj ? locObj.kode_lokasi : 'SEMUA_LOKASI';

  var parts = ym.split('-');
  var year = parseInt(parts[0], 10), month = parseInt(parts[1], 10);
  var lastDay = new Date(year, month, 0).getDate();
  var yy = String(year).slice(-2), mm = String(month).padStart(2, '0');

  var emps = hrCache.employees.filter(function(e) { return e.status_kerja === 'AKTIF' && (!locId || e.location_id === locId); });
  if (!emps.length) { showToast('Tidak ada karyawan aktif untuk diekspor.', true); return; }

  var grid = {}, statusLabel = { IZIN: 'Izin', CUTI: 'Cuti', SAKIT: 'Sakit' };
  hrCache.monthlyRaw.forEach(function(a) {
    if (!grid[a.employee_id]) grid[a.employee_id] = {};
    var empMap = grid[a.employee_id];
    if (isNonWorkStatus(a.status)) {
      if (a.tanggal && a.tanggal.indexOf(ym) === 0) {
        if (!empMap[a.tanggal]) empMap[a.tanggal] = { inT: '', inU: '', outT: '', outU: '' };
        empMap[a.tanggal].inT = statusLabel[a.status] || a.status;
        empMap[a.tanggal].inU = a.foto_masuk_url || '';
      }
      return;
    }
    if (a.jam_masuk) {
      var dIn = getDateWIB(a.jam_masuk);
      if (dIn && dIn.indexOf(ym) === 0) {
        if (!empMap[dIn]) empMap[dIn] = { inT: '', inU: '', outT: '', outU: '' };
        var tIn = getHHMMWIB(a.jam_masuk);
        empMap[dIn].inT = empMap[dIn].inT ? (empMap[dIn].inT + ', ' + tIn) : tIn;
        if (!empMap[dIn].inU && a.foto_masuk_url) empMap[dIn].inU = a.foto_masuk_url;
      }
    }
    if (a.jam_pulang) {
      var dOut = getDateWIB(a.jam_pulang);
      if (dOut && dOut.indexOf(ym) === 0) {
        if (!empMap[dOut]) empMap[dOut] = { inT: '', inU: '', outT: '', outU: '' };
        var tOut = getHHMMWIB(a.jam_pulang);
        empMap[dOut].outT = empMap[dOut].outT ? (empMap[dOut].outT + ', ' + tOut) : tOut;
        if (!empMap[dOut].outU && a.foto_pulang_url) empMap[dOut].outU = a.foto_pulang_url;
      }
    }
  });

  var row1 = [''], row2 = ['Nama Karyawan'], merges = [];
  for (var d = 1; d <= lastDay; d++) {
    var dd = String(d).padStart(2, '0'), colIdx = 1 + (d - 1) * 2;
    row1.push(dd + '/' + mm + '/' + yy, '');
    row2.push('Masuk', 'Pulang');
    merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + 1 } });
  }

  var aoa = [row1, row2], links = [];
  emps.forEach(function(e, rIdx) {
    var excelRow = rIdx + 2, row = [e.nama_lengkap || '-'], empMap = grid[e.id] || {};
    for (var d = 1; d <= lastDay; d++) {
      var ymd = ym + '-' + String(d).padStart(2, '0');
      var cData = empMap[ymd] || { inT: '', inU: '', outT: '', outU: '' };
      var colIn = 1 + (d - 1) * 2;
      row.push(cData.inT, cData.outT);
      if (cData.inT && cData.inU) links.push({ r: excelRow, c: colIn, url: cData.inU });
      if (cData.outT && cData.outU) links.push({ r: excelRow, c: colIn + 1, url: cData.outU });
    }
    aoa.push(row);
  });

  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  links.forEach(function(lk) {
    var addr = XLSX.utils.encode_cell({ r: lk.r, c: lk.c });
    if (ws[addr]) ws[addr].l = { Target: lk.url, Tooltip: 'Buka Foto Presensi' };
  });
  var cols = [{ wch: 26 }];
  for (var d = 1; d <= lastDay; d++) cols.push({ wch: 7.5 }, { wch: 7.5 });
  ws['!cols'] = cols;

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Presensi ' + ym);
  XLSX.writeFile(wb, 'Matriks_Presensi_' + locTag + '_' + ym + '.xlsx');
  showToast('Matriks Excel berhasil diunduh');
}

// ===== 03 / PENGAJUAN & IZIN =====
function renderRequests() {
  var mode = document.getElementById('filter-req').value;
  var pendingCount = hrCache.requests.filter(function(x) { return x.status === 'PENDING'; }).length;
  document.getElementById('k-req').textContent = pendingCount;
  var nb = document.getElementById('nav-req-badge');
  nb.textContent = pendingCount; nb.classList.toggle('hidden', pendingCount === 0);

  var list = mode === 'PENDING' ? hrCache.requests.filter(function(x) { return x.status === 'PENDING'; }) : hrCache.requests;
  var html = '';
  list.forEach(function(r) {
    var emp = r.hris_employees || {};
    var aksi = r.status === 'PENDING'
      ? '<button onclick="decideReq(\'' + r.id + '\',\'DISETUJUI\')" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 mr-1">✓ Setujui</button><button onclick="decideReq(\'' + r.id + '\',\'DITOLAK\')" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700">✕ Tolak</button>'
      : badgeStatus(r.status);
    var bukti = r.foto_bukti_url ? '<a href="' + r.foto_bukti_url + '" target="_blank" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">Lihat</a>' : '<span class="text-slate-300 dark:text-slate-600">—</span>';
    html += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-semibold">' + esc(emp.nama_lengkap || '-') + '</td>' +
      '<td class="py-3 px-4">' + badgeStatus(r.jenis) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs whitespace-nowrap">' + formatDateRange(r.tanggal, r.tanggal_selesai) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + (r.jam_koreksi ? r.jam_koreksi.slice(0, 5) : '—') + '</td>' +
      '<td class="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">' + esc(r.alasan) + '</td>' +
      '<td class="py-3 px-4">' + bukti + '</td>' +
      '<td class="py-3 px-4 text-right whitespace-nowrap">' + aksi + ' <button onclick="deleteRequest(\'' + r.id + '\')" title="Hapus" class="ml-1 px-2 py-1 rounded-lg text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">✕</button></td></tr>';
  });
  document.getElementById('req-body').innerHTML = html || '<tr><td colspan="7" class="py-8 px-4 text-center text-slate-400">Tidak ada pengajuan.</td></tr>';
}

function decideReq(id, decision) {
  if (!confirm('Yakin ' + decision + ' pengajuan ini?')) return;
  sb.rpc('hris_hr_decide_request', { p_req_id: id, p_decision: decision }).then(function(res) {
    if (res.error || !res.data || !res.data.ok) showToast(res.data ? res.data.message : 'Gagal memproses.', true);
    else { loadHrData(); showToast('Pengajuan ' + decision.toLowerCase()); }
  });
}

function deleteRequest(id) {
  if (!confirm('Hapus permanen data pengajuan ini?')) return;
  sb.from('hris_requests').delete().eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast('Gagal hapus: ' + r.error.message, true);
    else { loadHrData(); showToast('Pengajuan dihapus'); }
  });
}

// ===== 04 / KONTROL BPJS =====
function renderBpjs() {
  var mode = document.getElementById('filter-bpjs-mode').value;
  var locId = document.getElementById('filter-bpjs-loc').value;
  var alertCount = 0, dashHtml = '', bodyHtml = '';

  hrCache.bpjs.forEach(function(b) {
    var emp = b.hris_employees || {};
    var isAlert = (b.status_jkn === 'BELUM_DAFTAR' || b.status_jkn === 'PERLU_NONAKTIF' || b.status_kpj === 'BELUM_DAFTAR' || b.status_kpj === 'PERLU_NONAKTIF');
    if (isAlert) {
      alertCount++;
      dashHtml += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"><td class="py-3 px-4 font-mono text-xs font-semibold">' + esc(emp.nik_ktp || emp.nik_karyawan || '-') + '</td><td class="py-3 px-4 font-medium">' + esc(emp.nama_lengkap || '-') + '</td><td class="py-3 px-4 text-xs">' + esc(emp.status_kerja || '-') + '</td><td class="py-3 px-4">' + badgeStatus(b.status_jkn) + '</td><td class="py-3 px-4">' + badgeStatus(b.status_kpj) + '</td></tr>';
    }
    if (locId && emp.location_id !== locId) return;
    if (mode === 'ALERT' && !isAlert) return;
    if (mode === 'AKTIF' && !(b.status_jkn === 'AKTIF' && b.status_kpj === 'AKTIF')) return;

    bodyHtml += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-semibold">' + esc(emp.nama_lengkap || '-') + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + esc(emp.nik_ktp || '-') + '<div class="text-[11px] text-slate-400">KK: ' + esc(emp.no_kk || '-') + '</div></td>' +
      '<td class="py-3 px-4">' + badgeStatus(emp.status_kerja || '-') + '</td>' +
      '<td class="py-3 px-4">' + badgeStatus(b.status_jkn) + '<div class="text-[11px] text-slate-500 mt-1 font-mono">' + esc(b.no_jkn || '-') + (b.faskes_tk1 ? ' • ' + esc(b.faskes_tk1) : '') + '</div></td>' +
      '<td class="py-3 px-4">' + badgeStatus(b.status_kpj) + '<div class="text-[11px] text-slate-500 mt-1 font-mono">' + esc(b.no_kpj || '-') + '</div></td>' +
      '<td class="py-3 px-4 text-xs">' + (b.jumlah_tanggungan || 0) + ' org</td>' +
      '<td class="py-3 px-4 text-right"><button onclick="openBpjsModal(\'' + b.id + '\')" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">Update</button></td></tr>';
  });
  document.getElementById('k-bpjs').textContent = alertCount;
  document.getElementById('dash-bpjs-body').innerHTML = dashHtml || '<tr><td colspan="5" class="py-6 px-4 text-emerald-600 dark:text-emerald-400 font-medium">Semua BPJS aman.</td></tr>';
  document.getElementById('bpjs-body').innerHTML = bodyHtml || '<tr><td colspan="7" class="py-8 px-4 text-center text-slate-400">Tidak ada data BPJS sesuai filter.</td></tr>';
}

function openBpjsModal(bpjsId) {
  var b = hrCache.bpjs.find(function(x) { return x.id === bpjsId; });
  if (!b) return;
  var emp = b.hris_employees || {};
  var opts = ['BELUM_DAFTAR', 'PROSES_DAFTAR', 'AKTIF', 'PERLU_NONAKTIF', 'NONAKTIF'];
  function mkOpt(cur) { return opts.map(function(o) { return '<option value="' + o + '" ' + (cur === o ? 'selected' : '') + '>' + o + '</option>'; }).join(''); }
  openModal(
    '<div class="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800"><h3 class="text-base font-bold">Kontrol BPJS — ' + esc(emp.nama_lengkap || '') + '</h3><button onclick="closeModal()" class="p-1 text-slate-400">✕</button></div>' +
    '<p class="text-xs text-slate-500 mb-4 font-mono">NIK: <b>' + esc(emp.nik_ktp || '-') + '</b> | KK: <b>' + esc(emp.no_kk || '-') + '</b></p>' +
    '<form onsubmit="saveBpjsModal(event,\'' + b.id + '\')" class="space-y-4">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="' + LBL_CLS + '">Status JKN (Kesehatan)</label><select id="mb-jkn-st" class="' + INP_CLS + '">' + mkOpt(b.status_jkn) + '</select></div>' +
        '<div><label class="' + LBL_CLS + '">Nomor JKN</label><input id="mb-jkn-no" value="' + esc(b.no_jkn || '') + '" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Faskes Tk. 1</label><input id="mb-faskes" value="' + esc(b.faskes_tk1 || '') + '" class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Jumlah Tanggungan</label><input type="number" id="mb-tangg" value="' + (b.jumlah_tanggungan || 0) + '" min="0" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Status KPJ (Ketenagakerjaan)</label><select id="mb-kpj-st" class="' + INP_CLS + '">' + mkOpt(b.status_kpj) + '</select></div>' +
        '<div><label class="' + LBL_CLS + '">Nomor KPJ</label><input id="mb-kpj-no" value="' + esc(b.no_kpj || '') + '" class="' + INP_CLS + ' font-mono" /></div>' +
      '</div>' +
      '<div><label class="' + LBL_CLS + '">Catatan HR</label><input id="mb-cat" value="' + esc(b.catatan_hr || '') + '" class="' + INP_CLS + '" /></div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300">Batal</button><button type="submit" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900">Simpan BPJS</button></div>' +
    '</form>'
  );
}

function saveBpjsModal(ev, id) {
  ev.preventDefault();
  sb.from('hris_bpjs').update({
    status_jkn: document.getElementById('mb-jkn-st').value,
    no_jkn: document.getElementById('mb-jkn-no').value.trim(),
    faskes_tk1: document.getElementById('mb-faskes').value.trim(),
    jumlah_tanggungan: parseInt(document.getElementById('mb-tangg').value, 10) || 0,
    status_kpj: document.getElementById('mb-kpj-st').value,
    no_kpj: document.getElementById('mb-kpj-no').value.trim(),
    catatan_hr: document.getElementById('mb-cat').value.trim(),
    updated_at: new Date().toISOString()
  }).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast(r.error.message, true);
    else { closeModal(); loadHrData(); showToast('Data BPJS diperbarui'); }
  });
}

// ===== 05 / MASTER KARYAWAN =====
function renderEmployees() {
  var q = (document.getElementById('search-emp').value || '').toLowerCase();
  var locId = document.getElementById('filter-emp-loc').value;
  var aktif = 0, html = '';
  hrCache.employees.forEach(function(e) {
    if (e.status_kerja === 'AKTIF') aktif++;
    if (locId && e.location_id !== locId) return;
    var match = !q || (e.nama_lengkap || '').toLowerCase().indexOf(q) !== -1 || (e.nik_ktp || '').indexOf(q) !== -1 || (e.no_hp || '').indexOf(q) !== -1;
    if (!match) return;
    var loc = e.hris_locations ? (esc(e.hris_locations.nama_lokasi) + ' (' + esc(e.hris_locations.kota) + ')') : '-';
    if (hasFeature('people_multi_lokasi')) {
      if (e.allow_all_locations) loc += ' <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">SEMUA</span>';
      else if (e.extra_location_ids && e.extra_location_ids.length) loc += ' <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">+' + e.extra_location_ids.length + '</span>';
    }
    var shiftTag = e.is_shift_24h ? ' <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">24J</span>' : '';
    var faceTag = (hasFeature('people_face_rec') && e.face_rec_enabled === false) ? ' <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800">Face OFF</span>' : '';
    var bankInfo = (e.nama_bank || e.no_rekening) ? (esc(e.nama_bank || '-') + '<div class="text-[11px] font-mono text-slate-400">' + esc(e.no_rekening || '-') + '</div>') : '—';
    html += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-mono text-xs font-semibold">' + esc(e.nik_ktp || e.nik_karyawan) + '</td>' +
      '<td class="py-3 px-4"><div class="font-semibold">' + esc(e.nama_lengkap) + shiftTag + faceTag + '</div><div class="text-xs text-slate-500">' + esc(e.kategori) + (e.jabatan ? ' • ' + esc(e.jabatan) : '') + '</div></td>' +
      '<td class="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">' + loc + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">' + esc(e.no_hp || '—') + '</td>' +
      '<td class="py-3 px-4 text-xs">' + bankInfo + '</td>' +
      '<td class="py-3 px-4">' + badgeStatus(e.status_kerja) + '</td>' +
      '<td class="py-3 px-4 text-right"><button onclick="openEmpModal(\'' + e.id + '\')" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">Detail / Edit</button></td></tr>';
  });
  document.getElementById('k-emp').textContent = aktif;
  document.getElementById('emp-body').innerHTML = html || '<tr><td colspan="7" class="py-8 px-4 text-center text-slate-400">Tidak ada data karyawan.</td></tr>';
}

function autoPinFromKtp() {
  var ktp = document.getElementById('f-ktp').value.replace(/\D/g, '');
  if (ktp.length >= 6) document.getElementById('f-pin').value = ktp.slice(-6);
}

function addEmployee(e) {
  e.preventDefault();
  var ktp = document.getElementById('f-ktp').value.replace(/\D/g, '');
  var pin = document.getElementById('f-pin').value.trim() || (ktp.length >= 6 ? ktp.slice(-6) : '123456');
  sb.from('hris_employees').insert([{
    company_id: activeCompany.id, nik_karyawan: ktp, nik_ktp: ktp, no_kk: document.getElementById('f-kk').value.trim(),
    nama_lengkap: document.getElementById('f-nama').value.trim(), tanggal_lahir: document.getElementById('f-lahir').value || null,
    kategori: document.getElementById('f-kat').value, jabatan: document.getElementById('f-jab').value.trim(),
    location_id: document.getElementById('f-loc').value || null, no_hp: document.getElementById('f-hp').value.trim(),
    nama_bank: document.getElementById('f-bank').value.trim(), no_rekening: document.getElementById('f-rek').value.trim(),
    alamat: document.getElementById('f-alamat').value.trim(), is_shift_24h: document.getElementById('f-24h').checked,
    pin_code: pin, pin: pin
  }]).select().single().then(function(r) {
    if (r.error) { showToast(r.error.message, true); return; }
    sb.from('hris_bpjs').insert([{ company_id: activeCompany.id, employee_id: r.data.id }]).then(function() {
      e.target.reset(); loadHrData(); showToast('Karyawan berhasil ditambahkan');
    });
  });
}

function openEmpModal(empId) {
  var e = hrCache.employees.find(function(x) { return x.id === empId; });
  if (!e) return;
  var extraArr = e.extra_location_ids || [];
  var locOpts = '<option value="">-- Belum Diatur --</option>' + hrCache.locations.map(function(l) {
    return '<option value="' + l.id + '" ' + (e.location_id === l.id ? 'selected' : '') + '>' + esc(l.nama_lokasi) + ' (' + esc(l.kota) + ')</option>';
  }).join('');
  var extraChks = hrCache.locations.map(function(l) {
    var checked = extraArr.indexOf(l.id) !== -1 ? 'checked' : '';
    return '<label class="flex items-center gap-2 text-xs py-0.5 cursor-pointer"><input type="checkbox" class="me-extra-loc" value="' + l.id + '" ' + checked + ' /> ' + esc(l.nama_lokasi) + ' (' + esc(l.kota) + ')</label>';
  }).join('');
  var fd = e.face_descriptor;
  if (typeof fd === 'string') { try { fd = JSON.parse(fd); } catch (err) { fd = null; } }
  var faceReady = !!(fd && Array.isArray(fd) && fd.length === 128);

  var faceHtml = hasFeature('people_face_rec') ? (
    '<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700 space-y-2">' +
      '<label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="me-face-on" ' + (e.face_rec_enabled !== false ? 'checked' : '') + ' /> Aktifkan verifikasi wajah (Matikan jika HP jadul/lemot)</label>' +
      '<div class="flex items-center justify-between text-xs text-slate-500"><span>Data Wajah: <b>' + (faceReady ? 'Sudah terekam' : 'Belum terekam') + '</b></span>' +
      (faceReady ? '<button type="button" onclick="resetEmpFace(\'' + e.id + '\')" class="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium">↻ Reset Wajah</button>' : '') + '</div></div>'
  ) : '';

  var multiLocHtml = hasFeature('people_multi_lokasi') ? (
    '<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700 space-y-2">' +
      '<label class="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer"><input type="checkbox" id="me-all-loc" ' + (e.allow_all_locations ? 'checked' : '') + ' /> Boleh presensi di SEMUA lokasi (Rolling)</label>' +
      '<div class="max-h-28 overflow-y-auto pt-1">' + (extraChks || '<span class="text-xs text-slate-400">Belum ada lokasi.</span>') + '</div></div>'
  ) : '';

  openModal(
    '<div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800"><h3 class="text-base font-bold">Biodata & Pengaturan Karyawan</h3><button onclick="closeModal()" class="p-1 text-slate-400">✕</button></div>' +
    '<form onsubmit="saveEmpModal(event,\'' + e.id + '\')" class="space-y-4">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="' + LBL_CLS + '">NIK KTP (Login)</label><input id="me-ktp" value="' + esc(e.nik_ktp || '') + '" required class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">No. KK</label><input id="me-kk" value="' + esc(e.no_kk || '') + '" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Nama Lengkap</label><input id="me-nama" value="' + esc(e.nama_lengkap || '') + '" required class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">No. HP / WA</label><input id="me-hp" value="' + esc(e.no_hp || '') + '" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Kategori</label><select id="me-kat" class="' + INP_CLS + '"><option value="OS" ' + (e.kategori === 'OS' ? 'selected' : '') + '>OS</option><option value="INTERNAL" ' + (e.kategori === 'INTERNAL' ? 'selected' : '') + '>INTERNAL</option></select></div>' +
        '<div><label class="' + LBL_CLS + '">Jabatan</label><input id="me-jab" value="' + esc(e.jabatan || '') + '" class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Penempatan Utama</label><select id="me-loc" class="' + INP_CLS + '">' + locOpts + '</select></div>' +
        '<div><label class="' + LBL_CLS + '">Tanggal Masuk</label><input type="date" id="me-masuk" value="' + esc(e.tanggal_masuk || '') + '" class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Nama Bank</label><input id="me-bank" value="' + esc(e.nama_bank || '') + '" class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">No. Rekening</label><input id="me-rek" value="' + esc(e.no_rekening || '') + '" class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Tanggal Lahir</label><input type="date" id="me-lahir" value="' + esc(e.tanggal_lahir || '') + '" class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Status Kerja</label><select id="me-st" class="' + INP_CLS + '"><option value="AKTIF" ' + (e.status_kerja === 'AKTIF' ? 'selected' : '') + '>AKTIF</option><option value="RESIGN" ' + (e.status_kerja === 'RESIGN' ? 'selected' : '') + '>RESIGN</option><option value="HABIS_KONTRAK" ' + (e.status_kerja === 'HABIS_KONTRAK' ? 'selected' : '') + '>HABIS_KONTRAK</option></select></div>' +
      '</div>' +
      '<div><label class="' + LBL_CLS + '">Alamat Lengkap</label><input id="me-alamat" value="' + esc(e.alamat || '') + '" class="' + INP_CLS + '" /></div>' +
      '<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700"><label class="flex items-center gap-2 text-xs font-medium cursor-pointer"><input type="checkbox" id="me-24h" ' + (e.is_shift_24h ? 'checked' : '') + ' /> Shift 24 Jam (Jaga / Security — batas shift aktif 28 jam)</label></div>' +
      faceHtml + multiLocHtml +
      '<div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">' +
        '<div class="flex gap-2">' +
          '<button type="button" onclick="resetEmpPin(\'' + e.id + '\',\'' + esc(e.nik_ktp || e.nik_karyawan) + '\')" class="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700">↻ Reset PIN</button>' +
          '<button type="button" onclick="deleteEmployee(\'' + e.id + '\')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700">Hapus Permanen</button>' +
        '</div>' +
        '<button type="submit" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900">Simpan Perubahan</button>' +
      '</div>' +
    '</form>'
  );
}

function saveEmpModal(ev, id) {
  ev.preventDefault();
  var stBaru = document.getElementById('me-st').value;
  var mainLoc = document.getElementById('me-loc').value || null;
  var payload = {
    nik_ktp: document.getElementById('me-ktp').value.replace(/\D/g, ''),
    no_kk: document.getElementById('me-kk').value.trim(),
    nama_lengkap: document.getElementById('me-nama').value.trim(),
    no_hp: document.getElementById('me-hp').value.trim(),
    kategori: document.getElementById('me-kat').value,
    jabatan: document.getElementById('me-jab').value.trim(),
    location_id: mainLoc,
    tanggal_masuk: document.getElementById('me-masuk').value || null,
    nama_bank: document.getElementById('me-bank').value.trim(),
    no_rekening: document.getElementById('me-rek').value.trim(),
    tanggal_lahir: document.getElementById('me-lahir').value || null,
    alamat: document.getElementById('me-alamat').value.trim(),
    status_kerja: stBaru,
    tanggal_keluar: stBaru !== 'AKTIF' ? getTodayWIB() : null,
    is_shift_24h: document.getElementById('me-24h').checked
  };
  if (hasFeature('people_face_rec')) payload.face_rec_enabled = document.getElementById('me-face-on').checked;
  if (hasFeature('people_multi_lokasi')) {
    var extraIds = [];
    document.querySelectorAll('.me-extra-loc:checked').forEach(function(cb) { if (cb.value && cb.value !== mainLoc) extraIds.push(cb.value); });
    payload.allow_all_locations = document.getElementById('me-all-loc').checked;
    payload.extra_location_ids = extraIds;
  }
  sb.from('hris_employees').update(payload).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) { showToast(r.error.message, true); return; }
    if (stBaru !== 'AKTIF' && hasFeature('people_bpjs')) {
      sb.from('hris_bpjs').update({ status_jkn: 'PERLU_NONAKTIF', status_kpj: 'PERLU_NONAKTIF' }).eq('employee_id', id).eq('company_id', activeCompany.id).then(function() { closeModal(); loadHrData(); showToast('Biodata & status BPJS diperbarui'); });
    } else { closeModal(); loadHrData(); showToast('Biodata karyawan diperbarui'); }
  });
}

function resetEmpFace(id) {
  if (!confirm('Hapus data wajah tersimpan agar terekam ulang saat selfie berikutnya?')) return;
  sb.from('hris_employees').update({ face_descriptor: null }).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast(r.error.message, true);
    else { closeModal(); loadHrData(); showToast('Data wajah berhasil direset'); }
  });
}

function resetEmpPin(id, nik) {
  var clean = String(nik || '').replace(/\D/g, '');
  var newPin = clean.length >= 6 ? clean.slice(-6) : '123456';
  if (!confirm('Reset PIN karyawan ini kembali ke: ' + newPin + '?')) return;
  sb.from('hris_employees').update({ pin: newPin, pin_code: newPin }).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast(r.error.message, true);
    else { closeModal(); loadHrData(); showToast('PIN direset ke ' + newPin); }
  });
}

function deleteEmployee(id) {
  var e = hrCache.employees.find(function(x) { return x.id === id; });
  if (!confirm('Hapus permanen "' + (e ? e.nama_lengkap : 'karyawan ini') + '" beserta seluruh riwayat presensi & BPJS-nya?')) return;
  var cid = activeCompany.id;
  Promise.all([
    sb.from('hris_attendance').delete().eq('employee_id', id).eq('company_id', cid),
    sb.from('hris_requests').delete().eq('employee_id', id).eq('company_id', cid),
    sb.from('hris_bpjs').delete().eq('employee_id', id).eq('company_id', cid)
  ]).then(function() {
    return sb.from('hris_employees').delete().eq('id', id).eq('company_id', cid);
  }).then(function(r) {
    if (r.error) showToast('Gagal hapus: ' + r.error.message, true);
    else { closeModal(); loadHrData(); showToast('Karyawan dihapus permanen'); }
  });
}

// ===== CSV IMPORT / TEMPLATE =====
function downloadEmpTemplate() {
  var sampleKode = hrCache.locations.length ? hrCache.locations[0].kode_lokasi : 'LOC-01';
  var rows = [
    ['nik_ktp', 'no_kk', 'nama_lengkap', 'tanggal_lahir', 'kategori', 'jabatan', 'kode_lokasi', 'no_hp', 'alamat', 'nama_bank', 'no_rekening', 'shift_24_jam', 'no_jkn', 'faskes_tk1', 'no_kpj'],
    ['3515012345670001', '3515019999990001', 'Budi Santoso', '1995-08-17', 'OS', 'Security', sampleKode, '081234567890', 'Jl. Merdeka No 1', 'BRI', '123401000123501', 'YA', '', '', ''],
    ['3515012345670002', '3515019999990002', 'Siti Aminah', '1998-03-25', 'INTERNAL', 'Admin', sampleKode, '081298765432', 'Perum Indah Blok A', 'Mandiri', '1420012345678', 'TIDAK', '0001234567890', 'Puskesmas Setempat', '19001234567']
  ];
  downloadCSV('template_import_karyawan_lengkap.csv', rows);
}

function parseCsvDate(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  var ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) return ymd[1] + '-' + String(ymd[2]).padStart(2, '0') + '-' + String(ymd[3]).padStart(2, '0');
  var dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return dmy[3] + '-' + String(dmy[2]).padStart(2, '0') + '-' + String(dmy[1]).padStart(2, '0');
  return null;
}

function parseCSVLine(line, delim) {
  var res = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === delim && !inQ) { res.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  res.push(cur.trim());
  return res;
}

function importEmpCSV() {
  if (!hasFeature('people_import_csv')) { showToast('Fitur Import CSV belum aktif.', true); return; }
  var file = document.getElementById('csv-file').files[0];
  var st = document.getElementById('import-status');
  if (!file) { st.className = 'text-xs font-semibold mt-2 text-rose-600'; st.textContent = 'Pilih file CSV terlebih dahulu.'; return; }

  var btn = document.getElementById('btn-import-csv');
  btn.disabled = true; btn.textContent = 'Memproses...';
  st.className = 'text-xs font-semibold mt-2 text-blue-600'; st.textContent = 'Membaca file CSV...';

  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = e.target.result.split(/\r?\n/).filter(function(l) { return l.trim() !== ''; });
    if (lines.length < 2) { btn.disabled = false; btn.textContent = 'Import Sekarang'; st.className = 'text-xs font-semibold mt-2 text-rose-600'; st.textContent = 'File CSV kosong.'; return; }

    var delim = lines[0].indexOf(';') !== -1 ? ';' : ',';
    var headers = parseCSVLine(lines[0], delim).map(function(h) { return h.toLowerCase().replace(/[^a-z0-9_]/g, ''); });
    var locByKode = {};
    hrCache.locations.forEach(function(l) { locByKode[l.kode_lokasi.toUpperCase()] = l.id; locByKode[l.nama_lokasi.toUpperCase()] = l.id; });

    var empRows = [], bpjsMeta = {};
    for (var i = 1; i < lines.length; i++) {
      var cols = parseCSVLine(lines[i], delim), obj = {};
      headers.forEach(function(h, idx) { obj[h] = (cols[idx] || '').trim(); });
      var nikKtp = (obj.nik_ktp || obj.nik || '').replace(/[^0-9]/g, '');
      var nama = obj.nama_lengkap || obj.nama || '';
      if (!nikKtp || !nama) continue;

      var pinAuto = nikKtp.length >= 6 ? nikKtp.slice(-6) : '123456';
      var locKey = (obj.kode_lokasi || obj.lokasi || '').toUpperCase();
      var keyId = obj.id_karyawan ? obj.id_karyawan.toUpperCase() : nikKtp;
      var s24Raw = (obj.shift_24_jam || obj.is_shift_24h || '').toUpperCase();
      var is24h = (s24Raw === 'YA' || s24Raw === 'YES' || s24Raw === 'TRUE' || s24Raw === '1' || s24Raw === '24');

      empRows.push({
        company_id: activeCompany.id, nik_karyawan: keyId, nik_ktp: nikKtp, no_kk: (obj.no_kk || '').replace(/[^0-9]/g, ''),
        nama_lengkap: nama, tanggal_lahir: parseCsvDate(obj.tanggal_lahir || obj.tgl_lahir),
        kategori: (obj.kategori || 'OS').toUpperCase() === 'INTERNAL' ? 'INTERNAL' : 'OS',
        jabatan: obj.jabatan || '', location_id: locByKode[locKey] || null,
        no_hp: obj.no_hp || '', alamat: obj.alamat || '', nama_bank: obj.nama_bank || '', no_rekening: obj.no_rekening || '',
        is_shift_24h: is24h, pin: pinAuto, pin_code: pinAuto
      });
      bpjsMeta[keyId] = { no_jkn: obj.no_jkn || '', faskes_tk1: obj.faskes_tk1 || '', no_kpj: obj.no_kpj || '' };
    }

    if (!empRows.length) { btn.disabled = false; btn.textContent = 'Import Sekarang'; st.className = 'text-xs font-semibold mt-2 text-rose-600'; st.textContent = 'Tidak ada baris valid.'; return; }

    sb.from('hris_employees').upsert(empRows, { onConflict: 'company_id,nik_karyawan' }).select('id, nik_karyawan').then(function(res) {
      if (res.error) { btn.disabled = false; btn.textContent = 'Import Sekarang'; st.className = 'text-xs font-semibold mt-2 text-rose-600'; st.textContent = 'Gagal: ' + res.error.message; return; }
      var bpjsRows = (res.data || []).map(function(emp) {
        var m = bpjsMeta[emp.nik_karyawan] || {};
        return { company_id: activeCompany.id, employee_id: emp.id, no_jkn: m.no_jkn || null, faskes_tk1: m.faskes_tk1 || null, status_jkn: m.no_jkn ? 'AKTIF' : 'BELUM_DAFTAR', no_kpj: m.no_kpj || null, status_kpj: m.no_kpj ? 'AKTIF' : 'BELUM_DAFTAR' };
      });
      sb.from('hris_bpjs').upsert(bpjsRows, { onConflict: 'employee_id', ignoreDuplicates: true }).then(function() {
        btn.disabled = false; btn.textContent = 'Import Sekarang';
        document.getElementById('csv-file').value = '';
        st.className = 'text-xs font-semibold mt-2 text-emerald-600'; st.textContent = '✓ Berhasil import ' + empRows.length + ' karyawan lengkap!';
        loadHrData();
      });
    });
  };
  reader.readAsText(file);
}

// ===== 06 / LOKASI PENEMPATAN =====
function renderLocations() {
  var opts = hrCache.locations.map(function(l) { return '<option value="' + l.id + '">' + esc(l.nama_lokasi) + ' (' + esc(l.kota) + ')</option>'; }).join('');
  document.getElementById('f-loc').innerHTML = '<option value="">-- Pilih Lokasi --</option>' + opts;
  ['filter-pres-loc', 'filter-recap-loc', 'filter-bpjs-loc', 'filter-emp-loc'].forEach(function(id) {
    var el = document.getElementById(id), cur = el.value;
    el.innerHTML = '<option value="">Semua Lokasi</option>' + opts;
    el.value = cur;
  });
  var html = '';
  hrCache.locations.forEach(function(l) {
    html += '<tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">' +
      '<td class="py-3 px-4 font-mono text-xs font-bold">' + esc(l.kode_lokasi) + '</td>' +
      '<td class="py-3 px-4 font-semibold">' + esc(l.nama_lokasi) + '</td>' +
      '<td class="py-3 px-4 text-slate-600 dark:text-slate-400">' + esc(l.kota) + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs text-slate-500">' + l.latitude + ', ' + l.longitude + '</td>' +
      '<td class="py-3 px-4 font-mono text-xs">' + l.radius_meter + ' m</td>' +
      '<td class="py-3 px-4 text-right whitespace-nowrap"><button onclick="openLocModal(\'' + l.id + '\')" class="px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mr-1.5">Edit</button><button onclick="deleteLocation(\'' + l.id + '\')" class="px-2 py-1 rounded-lg text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">✕</button></td></tr>';
  });
  document.getElementById('loc-body').innerHTML = html || '<tr><td colspan="6" class="py-8 px-4 text-center text-slate-400">Belum ada lokasi.</td></tr>';
}

function addLocation(e) {
  e.preventDefault();
  sb.from('hris_locations').insert([{
    company_id: activeCompany.id,
    kode_lokasi: document.getElementById('l-kode').value.trim().toUpperCase(),
    nama_lokasi: document.getElementById('l-nama').value.trim(),
    kota: document.getElementById('l-kota').value.trim(),
    latitude: parseFloat(document.getElementById('l-lat').value),
    longitude: parseFloat(document.getElementById('l-lng').value),
    radius_meter: parseInt(document.getElementById('l-rad').value, 10)
  }]).then(function(r) {
    if (r.error) showToast(r.error.message, true);
    else { e.target.reset(); loadHrData(); showToast('Lokasi ditambahkan'); }
  });
}

function openLocModal(locId) {
  var l = hrCache.locations.find(function(x) { return x.id === locId; });
  if (!l) return;
  openModal(
    '<div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800"><h3 class="text-base font-bold">Edit Lokasi Penempatan</h3><button onclick="closeModal()" class="p-1 text-slate-400">✕</button></div>' +
    '<form onsubmit="saveLocModal(event,\'' + l.id + '\')" class="space-y-4">' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div><label class="' + LBL_CLS + '">Kode Lokasi</label><input id="ml-kode" value="' + esc(l.kode_lokasi || '') + '" required class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Nama Lokasi</label><input id="ml-nama" value="' + esc(l.nama_lokasi || '') + '" required class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Kota</label><input id="ml-kota" value="' + esc(l.kota || '') + '" required class="' + INP_CLS + '" /></div>' +
        '<div><label class="' + LBL_CLS + '">Radius (Meter)</label><input id="ml-rad" type="number" value="' + (l.radius_meter || 100) + '" required class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Latitude</label><input id="ml-lat" type="number" step="any" value="' + l.latitude + '" required class="' + INP_CLS + ' font-mono" /></div>' +
        '<div><label class="' + LBL_CLS + '">Longitude</label><input id="ml-lng" type="number" step="any" value="' + l.longitude + '" required class="' + INP_CLS + ' font-mono" /></div>' +
      '</div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300">Batal</button><button type="submit" class="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900">Simpan Lokasi</button></div>' +
    '</form>'
  );
}

function saveLocModal(ev, id) {
  ev.preventDefault();
  sb.from('hris_locations').update({
    kode_lokasi: document.getElementById('ml-kode').value.trim().toUpperCase(),
    nama_lokasi: document.getElementById('ml-nama').value.trim(),
    kota: document.getElementById('ml-kota').value.trim(),
    latitude: parseFloat(document.getElementById('ml-lat').value),
    longitude: parseFloat(document.getElementById('ml-lng').value),
    radius_meter: parseInt(document.getElementById('ml-rad').value, 10)
  }).eq('id', id).eq('company_id', activeCompany.id).then(function(r) {
    if (r.error) showToast(r.error.message, true);
    else { closeModal(); loadHrData(); showToast('Lokasi diperbarui'); }
  });
}

function deleteLocation(id) {
  var l = hrCache.locations.find(function(x) { return x.id === id; });
  if (!confirm('Hapus lokasi "' + (l ? l.nama_lokasi : 'ini') + '"?')) return;
  var cid = activeCompany.id;
  Promise.all([
    sb.from('hris_employees').update({ location_id: null }).eq('location_id', id).eq('company_id', cid),
    sb.from('hris_attendance').update({ location_id: null }).eq('location_id', id).eq('company_id', cid)
  ]).then(function() {
    return sb.from('hris_locations').delete().eq('id', id).eq('company_id', cid);
  }).then(function(r) {
    if (r.error) showToast('Gagal hapus: ' + r.error.message, true);
    else { loadHrData(); showToast('Lokasi dihapus'); }
  });
}

// ===== 07 / PENGATURAN & EXPORTS =====
function saveSettings(e) {
  e.preventDefault();
  if (!activeCompany) return;
  var newBranding = Object.assign({}, activeCompany.branding || {}, {
    company_name: document.getElementById('s-comp').value.trim(),
    app_subtitle: document.getElementById('s-sub').value.trim(),
    logo_url: document.getElementById('s-logo').value.trim(),
    primary_color: document.getElementById('s-col').value,
    admin_wa: document.getElementById('s-wa').value.trim()
  });
  var newIntegrations = Object.assign({}, activeCompany.integrations || {}, {
    people_drive_webhook: document.getElementById('s-drv').value.trim(),
    people_drive_secret: document.getElementById('s-drv-sec').value.trim()
  });
  sb.from('companies').update({ branding: newBranding, integrations: newIntegrations, updated_at: new Date().toISOString() }).eq('id', activeCompany.id).then(function(r) {
    if (r.error) { showToast(r.error.message, true); return; }
    activeCompany.branding = newBranding; activeCompany.integrations = newIntegrations;
    applyBranding(newBranding, hasFeature('custom_whitelabel'));
    showToast('Pengaturan perusahaan tersimpan');
  });
}

function exportAttendanceCSV() {
  var tgl = document.getElementById('filter-date').value, locId = document.getElementById('filter-pres-loc').value;
  var rows = [['Tanggal', 'NIK', 'Nama', 'Lokasi Aktual', 'Masuk', 'Pulang', 'Status', 'Wajah Masuk', 'Wajah Pulang', 'Keterangan', 'Foto Masuk', 'Foto Pulang']];
  hrCache.attendance.filter(function(a) { var al = a.location_id || (a.hris_employees && a.hris_employees.location_id); return !locId || al === locId; }).forEach(function(a) {
    var e = a.hris_employees || {}, l = (a.hris_locations && a.hris_locations.nama_lokasi) ? a.hris_locations.nama_lokasi : (e.hris_locations ? e.hris_locations.nama_lokasi : '-');
    rows.push([tgl, e.nik_karyawan, e.nama_lengkap, l, formatTimeWIB(a.jam_masuk), formatTimeWIB(a.jam_pulang), a.status === 'TERLAMBAT' ? 'HADIR' : a.status, a.face_status_masuk || a.face_status || '-', a.face_status_pulang || '-', a.keterangan || '', a.foto_masuk_url, a.foto_pulang_url]);
  });
  downloadCSV('presensi_harian_' + tgl + '.csv', rows);
  showToast('CSV Harian diunduh');
}

function exportMonthlyCSV() {
  var ym = document.getElementById('filter-month').value;
  var rows = [['Bulan', 'NIK KTP', 'Nama Karyawan', 'Lokasi Utama', 'Hadir', 'Dinas Luar', 'Izin', 'Cuti', 'Sakit', 'Lupa Pulang', 'Total Masuk']];
  hrCache.monthlySummary.forEach(function(r) { rows.push([ym, r.nik, r.nama, r.loc, r.hadir, r.dl, r.izin, r.cuti, r.sakit, r.lupa, r.total]); });
  downloadCSV('rekap_presensi_' + ym + '.csv', rows);
  showToast('Ringkasan CSV diunduh');
}

function exportBpjsCSV() {
  var rows = [['NIK KTP', 'No KK', 'Nama', 'Status Kerja', 'No JKN', 'Faskes Tk1', 'Status JKN', 'No KPJ', 'Status KPJ', 'Tanggungan', 'Catatan HR']];
  hrCache.bpjs.forEach(function(b) { var e = b.hris_employees || {}; rows.push([e.nik_ktp, e.no_kk, e.nama_lengkap, e.status_kerja, b.no_jkn, b.faskes_tk1, b.status_jkn, b.no_kpj, b.status_kpj, b.jumlah_tanggungan, b.catatan_hr]); });
  downloadCSV('kontrol_bpjs_' + getTodayWIB() + '.csv', rows);
  showToast('CSV BPJS diunduh');
}

function exportMasterEmpCSV() {
  var rows = [['NIK KTP', 'No KK', 'Nama Lengkap', 'Tgl Lahir', 'Kategori', 'Jabatan', 'Penempatan Utama', 'Shift 24 Jam', 'No HP', 'Alamat', 'Nama Bank', 'No Rekening', 'Tgl Masuk', 'Status Kerja']];
  hrCache.employees.forEach(function(e) { var l = e.hris_locations ? e.hris_locations.nama_lokasi : '-'; rows.push([e.nik_ktp, e.no_kk, e.nama_lengkap, e.tanggal_lahir || '', e.kategori, e.jabatan, l, e.is_shift_24h ? 'YA' : 'TIDAK', e.no_hp, e.alamat, e.nama_bank, e.no_rekening, e.tanggal_masuk, e.status_kerja]); });
  downloadCSV('master_karyawan_' + getTodayWIB() + '.csv', rows);
  showToast('Biodata CSV diunduh');
}
