var empSession = null, currentGPS = null, gpsWatchId = null, lastGpsStatus = 'Mencari GPS', pendingType = null, pendingIsDL = false;
var publicAdminWa = '';
var activeFeatures = {};
var faceApiPromise = null;
var FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
var clockStarted = false;

window.onload = function() {
  // Redirect otomatis jika ada bookmark lama ke #admin
  if (window.location.hash === '#admin') {
    window.location.replace('/admin.html' + window.location.search);
    return;
  }
  detectTenant();
  var today = getTodayWIB();
  document.getElementById('req-tgl').value = today;
  document.getElementById('req-tgl-end').value = today;
  var adminLink = document.getElementById('link-to-hr');
  if (adminLink && window.location.search) adminLink.href = '/admin.html' + window.location.search;
  loadBranding();
  checkExistingEmpSession();
};

function hasFeature(key) { return !!(activeFeatures && activeFeatures[key] === true); }
function toggleBox(id) { document.getElementById(id).classList.toggle('hidden'); }
function showLoginErr(msg) { var el = document.getElementById('login-msg'); el.textContent = msg; el.classList.remove('hidden'); }

function showOverlay(mode, title, sub) {
  var isOk = (mode === 'success');
  document.getElementById('ov-spin').classList.toggle('hidden', isOk);
  document.getElementById('ov-check').classList.toggle('hidden', !isOk);
  document.getElementById('ov-btn').classList.toggle('hidden', !isOk);
  document.getElementById('ov-title').textContent = title;
  document.getElementById('ov-title').style.color = isOk ? 'var(--green)' : 'var(--text)';
  document.getElementById('ov-sub').textContent = sub;
  document.getElementById('emp-overlay').classList.remove('hidden');
}
function hideOverlay() { document.getElementById('emp-overlay').classList.add('hidden'); }

function applyBranding(b) {
  if (!b) return;
  if (b.primary_color) {
    document.documentElement.style.setProperty('--primary', b.primary_color);
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', b.primary_color);
  }
  var compName = b.company_name || 'PORTAL PRESENSI';
  document.title = 'Presensi — ' + compName;
  document.getElementById('login-company').textContent = compName;
  document.getElementById('emp-company').textContent = compName;

  var logoUrl = (b.logo_url || '').trim();
  ['login-logo', 'emp-logo'].forEach(function(id) {
    var img = document.getElementById(id);
    if (logoUrl) { img.src = logoUrl; img.classList.remove('hidden'); }
    else { img.classList.add('hidden'); }
  });

  if (b.admin_wa !== undefined) {
    publicAdminWa = formatWaNumber(b.admin_wa);
    document.getElementById('login-help-wa').classList.toggle('hidden', publicAdminWa.length < 9);
  }
}

function loadBranding() {
  sb.rpc('hris_get_public_branding', {
    p_slug: tenantContext.slug,
    p_domain: tenantContext.domain
  }).then(function(r) {
    if (r.data && r.data.ok) {
      if (!tenantContext.slug && r.data.slug) tenantContext.slug = r.data.slug;
      applyBranding(r.data);
      if (r.data.status !== 'ACTIVE') {
        showLoginErr('Portal perusahaan ini sedang dinonaktifkan.');
      }
    }
  });
}

function getEmpStorageKey() {
  var slugParam = (new URLSearchParams(window.location.search).get('c') || '').trim().toLowerCase();
  return 'hris_emp_cred_' + (slugParam || window.location.hostname.toLowerCase());
}

function checkExistingEmpSession() {
  var saved = localStorage.getItem(getEmpStorageKey()) || localStorage.getItem('hris_emp_cred');
  if (saved) {
    try {
      var c = JSON.parse(saved);
      if (c && c.nik && c.pin) callEmpLogin(c.nik, c.pin, true);
    } catch (e) {}
  }
}

function openLoginHelpWa(e) {
  e.preventDefault();
  if (!publicAdminWa) return;
  var msg = 'Halo Admin, saya butuh bantuan untuk masuk ke aplikasi Presensi (lupa PIN / kendala login).';
  window.open('https://wa.me/' + publicAdminWa + '?text=' + encodeURIComponent(msg), '_blank');
}

// ===== FACE RECOGNITION LAZY LOADER (0.25 DETEKSI / 0.55 KECOCOKAN) =====
function ensureFaceModels() {
  if (faceApiPromise) return faceApiPromise;
  faceApiPromise = new Promise(function(resolve, reject) {
    function loadModels() {
      Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
      ]).then(function() { resolve(true); }).catch(reject);
    }
    if (window.faceapi) { loadModels(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
    s.async = true;
    s.onload = loadModels;
    s.onerror = function() { reject(new Error('Gagal memuat face-api')); };
    document.head.appendChild(s);
  }).catch(function(err) {
    faceApiPromise = null;
    throw err;
  });
  return faceApiPromise;
}

function verifyFaceOnCanvas(canvas) {
  var emp = empSession && empSession.data && empSession.data.employee;
  if (!hasFeature('people_face_rec') || !emp || emp.face_rec_enabled === false) {
    return Promise.resolve({ status: 'DISABLED', distance: null, newDescriptor: null });
  }
  var timeoutP = new Promise(function(resolve) {
    setTimeout(function() { resolve({ status: 'TIMEOUT', distance: null, newDescriptor: null }); }, 10000);
  });
  var detectP = ensureFaceModels().then(function() {
    var opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 });
    return faceapi.detectSingleFace(canvas, opts).withFaceLandmarks(true).withFaceDescriptor();
  }).then(function(det) {
    if (!det || !det.descriptor) return { status: 'NO_FACE', distance: null, newDescriptor: null };
    var arr = (Array.from ? Array.from(det.descriptor) : Array.prototype.slice.call(det.descriptor)).map(function(n) {
      return Math.round(n * 10000) / 10000;
    });
    var savedDesc = emp.face_descriptor;
    if (typeof savedDesc === 'string') {
      try { savedDesc = JSON.parse(savedDesc); } catch (e) { savedDesc = null; }
    }
    if (!savedDesc || !Array.isArray(savedDesc) || savedDesc.length !== 128) {
      return { status: 'ENROLLED', distance: 0, newDescriptor: arr };
    }
    var dist = faceapi.euclideanDistance(det.descriptor, new Float32Array(savedDesc));
    dist = Math.round(dist * 1000) / 1000;
    return { status: (dist < 0.55 ? 'VERIFIED' : 'MISMATCH'), distance: dist, newDescriptor: null };
  }).catch(function() {
    return { status: 'TIMEOUT', distance: null, newDescriptor: null };
  });
  return Promise.race([detectP, timeoutP]);
}

// ===== WATERMARK FOTO =====
function drawWatermarkOnCanvas(canvas, nama, locLabel, tipe) {
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  var barH = Math.max(66, Math.round(h * 0.13));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, h - barH, w, barH);

  var now = new Date();
  var tgl = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' });
  var jam = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
  var fs = Math.max(12, Math.round(w * 0.026));
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  var padX = 12, startY = h - barH + Math.round((barH - (fs * 3.5)) / 2);

  ctx.font = 'bold ' + fs + 'px Arial, sans-serif';
  ctx.fillText(String(nama || '-').toUpperCase() + '  [' + tipe + ']', padX, startY);
  ctx.font = Math.round(fs * 0.92) + 'px Arial, sans-serif';
  ctx.fillText(tgl + ' • ' + jam, padX, startY + Math.round(fs * 1.25));
  ctx.fillStyle = '#FDE68A';
  ctx.fillText(String(locLabel || '-'), padX, startY + Math.round(fs * 2.4));
}

// ===== LOGIN & PORTAL KARYAWAN =====
function handleEmpLogin(e) {
  e.preventDefault();
  document.getElementById('login-msg').classList.add('hidden');
  callEmpLogin(document.getElementById('emp-nik').value.trim(), document.getElementById('emp-pin').value.trim(), false);
}

function callEmpLogin(nik, pin, silent) {
  var btn = document.getElementById('btn-emp-login');
  if (!silent) { btn.disabled = true; btn.textContent = 'Memeriksa...'; }
  sb.rpc('hris_emp_login', {
    p_nik: nik, p_pin: pin,
    p_company_slug: tenantContext.slug,
    p_domain: tenantContext.domain
  }).then(function(res) {
    if (!silent) { btn.disabled = false; btn.textContent = 'MASUK'; }
    var d = res.data;
    if (res.error || !d || !d.ok) {
      if (!silent) showLoginErr(d && d.message ? d.message : 'NIK atau PIN salah.');
      return;
    }
    if (d.company && d.company.slug) tenantContext.slug = d.company.slug;
    activeFeatures = d.features || {};
    localStorage.setItem(getEmpStorageKey(), JSON.stringify({ nik: nik, pin: pin }));
    empSession = { data: d, nik: nik, pin: pin };
    applyBranding(d.settings);

    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-emp').classList.remove('hidden');
    document.getElementById('emp-name').textContent = d.employee.nama_lengkap;

    var locs = d.allowed_locations || [];
    if (hasFeature('people_multi_lokasi') && d.employee.allow_all_locations) {
      document.getElementById('emp-loc-label').textContent = 'Penempatan: Semua Lokasi Kantor (Rolling)';
    } else if (d.location) {
      var extraCount = hasFeature('people_multi_lokasi') ? Math.max(0, locs.length - 1) : 0;
      document.getElementById('emp-loc-label').textContent = 'Penempatan: ' + d.location.nama_lokasi + ' (' + d.location.kota + ')' + (extraCount > 0 ? ' + ' + extraCount + ' lokasi lain' : '');
    } else {
      document.getElementById('emp-loc-label').textContent = 'Penempatan: Belum diatur HR';
    }

    document.getElementById('btn-menu-req').classList.toggle('hidden', !hasFeature('people_pengajuan'));
    if (!hasFeature('people_pengajuan')) {
      document.getElementById('box-req-form').classList.add('hidden');
      document.getElementById('box-req-hist').classList.add('hidden');
    }

    var wa = formatWaNumber(d.settings && d.settings.admin_wa);
    document.getElementById('btn-wa-admin').classList.toggle('hidden', wa.length < 9);

    if (hasFeature('people_face_rec') && d.employee.face_rec_enabled !== false) {
      setTimeout(function() { ensureFaceModels().catch(function() {}); }, 1500);
    }

    updateEmpButtons();
    renderEmpHistory(d.recent_attendance || []);
    if (hasFeature('people_pengajuan')) renderEmpReqHistory(d.recent_requests || []);
    startClock();
    startLiveGPS();
  });
}

function openWaAdmin() {
  var wa = formatWaNumber(empSession && empSession.data && empSession.data.settings && empSession.data.settings.admin_wa);
  if (!wa) return;
  var emp = empSession.data.employee || {};
  var loc = empSession.data.location ? (empSession.data.location.nama_lokasi + ' (' + empSession.data.location.kota + ')') : 'Belum diatur';
  var msg = 'Halo Admin, saya ' + (emp.nama_lengkap || '-') + ' (NIK: ' + (emp.nik_ktp || emp.nik_karyawan || '-') + ') di penempatan ' + loc + ' mengalami kendala presensi.\nStatus GPS: ' + lastGpsStatus + '.\nMohon bantuannya.';
  window.open('https://wa.me/' + wa + '?text=' + encodeURIComponent(msg), '_blank');
}

function badgeStatus(st) {
  if (st === 'AKTIF' || st === 'HADIR' || st === 'DISETUJUI') return '<span class="badge b-green">' + st + '</span>';
  if (st === 'DINAS_LUAR') return '<span class="badge b-blue">DINAS LUAR</span>';
  if (st === 'CUTI') return '<span class="badge b-teal">CUTI</span>';
  if (st === 'IZIN' || st === 'PENDING') return '<span class="badge b-orange">' + st + '</span>';
  if (st === 'SAKIT') return '<span class="badge b-purple">SAKIT</span>';
  if (st === 'DITOLAK') return '<span class="badge b-red">' + st + '</span>';
  return '<span class="badge b-gray">' + st + '</span>';
}

function formatPulangCell(a, isShift24) {
  if (isNonWorkStatus(a.status)) return '-';
  if (a.jam_pulang) {
    if (!a.jam_masuk) return formatTimeWIB(a.jam_pulang);
    return formatTimeWIB(a.jam_pulang) + (getDateWIB(a.jam_pulang) !== getDateWIB(a.jam_masuk) ? ' (+1 hr)' : '');
  }
  if (isLupaPulang(a, isShift24)) return '<span class="badge b-red">LUPA PULANG</span>';
  return '<span style="color:var(--muted)">Sedang kerja</span>';
}

function renderEmpHistory(list) {
  var el = document.getElementById('emp-hist-list');
  if (!list || !list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Belum ada riwayat presensi 14 hari terakhir.</div>'; return; }
  var is24 = !!(empSession && empSession.data && empSession.data.employee && empSession.data.employee.is_shift_24h);
  var html = '';
  list.forEach(function(a) {
    var st = (a.status === 'TERLAMBAT') ? 'HADIR' : a.status;
    var jamInfo = isNonWorkStatus(st)
      ? '<small style="color:var(--muted)">Tidak hadir (' + st + ')</small>'
      : '<small style="color:var(--muted)">Masuk: <b>' + formatTimeWIB(a.jam_masuk) + '</b> | Pulang: <b>' + formatPulangCell(a, is24) + '</b></small>';
    html += '<div class="list-row"><div><strong>' + a.tanggal + '</strong><br>' + jamInfo + '</div>' + badgeStatus(st) + '</div>';
  });
  el.innerHTML = html;
}

function submitChangePin(e) {
  e.preventDefault();
  var oldP = document.getElementById('pin-old').value.trim();
  var newP = document.getElementById('pin-new').value.trim();
  var confP = document.getElementById('pin-conf').value.trim();
  if (newP !== confP) { showEmpMsg('Konfirmasi PIN baru tidak sama.', false); return; }
  if (!/^[0-9]{6}$/.test(newP)) { showEmpMsg('PIN baru wajib tepat 6 angka.', false); return; }

  var btn = document.getElementById('btn-pin-save');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  sb.rpc('hris_emp_change_pin', {
    p_nik: empSession.nik, p_old_pin: oldP, p_new_pin: newP,
    p_company_slug: tenantContext.slug, p_domain: tenantContext.domain
  }).then(function(res) {
    btn.disabled = false; btn.textContent = 'SIMPAN PIN BARU';
    if (res.error || !res.data || !res.data.ok) { showEmpMsg(res.data ? res.data.message : 'Gagal ganti PIN.', false); return; }
    empSession.pin = newP;
    localStorage.setItem(getEmpStorageKey(), JSON.stringify({ nik: empSession.nik, pin: newP }));
    e.target.reset();
    document.getElementById('box-pin-form').classList.add('hidden');
    showEmpMsg('PIN berhasil diganti! Gunakan PIN baru untuk login berikutnya.', true);
  });
}

function updateEmpButtons() {
  var active = empSession.data.active_shift;
  var doneCount = empSession.data.today_done || 0;
  var banner = document.getElementById('shift-banner');
  if (active) {
    banner.className = 'shift-banner shift-active';
    document.getElementById('shift-title').textContent = 'Sedang Bekerja (Masuk: ' + formatTimeWIB(active.jam_masuk) + ')';
    document.getElementById('shift-sub').textContent = 'Tekan PRESENSI PULANG saat selesai bertugas';
  } else {
    banner.className = 'shift-banner';
    document.getElementById('shift-title').textContent = 'Siap Presensi Masuk';
    document.getElementById('shift-sub').textContent = doneCount > 0 ? ('Sudah selesai ' + doneCount + ' shift hari ini (Bisa masuk shift berikutnya)') : 'Belum ada shift berjalan';
  }

  var isOutside = currentGPS && !currentGPS.inRadius;
  var allowDL = hasFeature('people_dinas_luar');
  document.getElementById('box-normal').classList.toggle('hidden', !!isOutside);
  document.getElementById('box-dinas-luar').classList.toggle('hidden', !(isOutside && allowDL));
  document.getElementById('btn-masuk').classList.toggle('hidden', !!active);
  document.getElementById('btn-pulang').classList.toggle('hidden', !active);
  document.getElementById('btn-dl-masuk').classList.toggle('hidden', !!active);
  document.getElementById('btn-dl-pulang').classList.toggle('hidden', !active);

  var noGps = !currentGPS;
  ['btn-masuk', 'btn-pulang', 'btn-dl-masuk', 'btn-dl-pulang'].forEach(function(id) { document.getElementById(id).disabled = noGps; });
  document.getElementById('sub-masuk').textContent = noGps ? 'Aktifkan GPS di atas terlebih dahulu' : 'Tekan untuk foto selfie & mulai kerja';
  document.getElementById('sub-pulang').textContent = noGps ? 'Aktifkan GPS di atas terlebih dahulu' : 'Tekan untuk foto selfie & selesai kerja';
}

function onReqJenisChange() {
  var j = document.getElementById('req-jenis').value;
  var needJam = (j === 'LUPA_MASUK' || j === 'LUPA_PULANG');
  document.getElementById('req-jam-wrap').classList.toggle('hidden', !needJam);
  document.getElementById('req-tgl-end-wrap').classList.toggle('hidden', needJam);
  document.getElementById('req-tgl-label').textContent = needJam ? 'Tanggal' : 'Dari Tanggal';
  document.getElementById('req-jam').value = (j === 'LUPA_PULANG') ? '17:00' : '08:00';
}

function syncReqEndDate() {
  var s = document.getElementById('req-tgl').value;
  var eEl = document.getElementById('req-tgl-end');
  if (s && (!eEl.value || eEl.value < s)) eEl.value = s;
}

function renderEmpReqHistory(list) {
  var box = document.getElementById('box-req-hist');
  if (!list || !list.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  var html = '';
  list.forEach(function(r) {
    var stB = r.status === 'DISETUJUI' ? 'b-green' : (r.status === 'DITOLAK' ? 'b-red' : 'b-orange');
    var tglTxt = formatDateRange(r.tanggal, r.tanggal_selesai);
    html += '<div class="list-row"><div><strong>' + r.jenis.replace('_', ' ') + '</strong> (' + tglTxt + ')<br><small style="color:var(--muted)">' + esc(r.alasan) + '</small></div><span class="badge ' + stB + '">' + (r.status === 'PENDING' ? 'MENUNGGU' : r.status) + '</span></div>';
  });
  document.getElementById('emp-req-list').innerHTML = html;
}

function submitEmpRequest(e) {
  e.preventDefault();
  if (!hasFeature('people_pengajuan')) { showEmpMsg('Fitur pengajuan tidak aktif.', false); return; }
  var btn = document.getElementById('btn-req-send');
  var jenis = document.getElementById('req-jenis').value;
  var tgl = document.getElementById('req-tgl').value;
  var isMulti = isNonWorkStatus(jenis);
  var tglEnd = isMulti ? (document.getElementById('req-tgl-end').value || tgl) : tgl;
  if (isMulti && tglEnd < tgl) { showEmpMsg('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.', false); return; }
  var jam = (jenis === 'LUPA_MASUK' || jenis === 'LUPA_PULANG') ? document.getElementById('req-jam').value : '';
  var alasan = document.getElementById('req-alasan').value.trim();
  var fileInp = document.getElementById('req-foto');

  btn.disabled = true; btn.textContent = 'Mengirim...';
  function sendRpc(fotoUrl) {
    sb.rpc('hris_emp_submit_request', {
      p_nik: empSession.nik, p_pin: empSession.pin, p_jenis: jenis,
      p_tanggal: tgl, p_tanggal_selesai: tglEnd,
      p_jam: jam, p_alasan: alasan, p_foto_url: fotoUrl,
      p_company_slug: tenantContext.slug, p_domain: tenantContext.domain
    }).then(function(res) {
      btn.disabled = false; btn.textContent = 'KIRIM PENGAJUAN';
      if (res.error || !res.data || !res.data.ok) { showEmpMsg(res.data ? res.data.message : 'Gagal kirim pengajuan.', false); return; }
      e.target.reset();
      var today = getTodayWIB();
      document.getElementById('req-tgl').value = today;
      document.getElementById('req-tgl-end').value = today;
      onReqJenisChange();
      document.getElementById('box-req-form').classList.add('hidden');
      showEmpMsg('Pengajuan terkirim ke HR! Tunggu persetujuan.', true);
      callEmpLogin(empSession.nik, empSession.pin, true);
    });
  }

  var webhook = empSession.data.settings ? empSession.data.settings.drive_webhook_url : '';
  var secret = empSession.data.settings ? empSession.data.settings.drive_secret : '';
  if (fileInp.files && fileInp.files[0] && webhook && webhook.indexOf('script.google.com') !== -1) {
    fileToCanvas(fileInp.files[0], function(canvas) {
      var base64 = canvas.toDataURL('image/jpeg', 0.65);
      uploadDrive(webhook, { secret: secret, lokasi: 'IZIN_SAKIT', tipe: 'MASUK', namaKaryawan: empSession.data.employee.nama_lengkap + '_' + jenis, imageBase64: base64 }, 1, function(err, url) { sendRpc(err ? '' : url); });
    });
  } else sendRpc('');
}

function startClock() {
  if (clockStarted) return;
  clockStarted = true;
  function tick() {
    var n = new Date();
    document.getElementById('emp-clock').textContent = n.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('emp-date').textContent = n.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  tick(); setInterval(tick, 1000);
}

// ===== GPS =====
function calcDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function handleGpsSuccess(pos) {
  var box = document.getElementById('gps-box'), title = document.getElementById('gps-title'), desc = document.getElementById('gps-desc');
  var locs = (empSession && empSession.data && empSession.data.allowed_locations) ? empSession.data.allowed_locations : [];
  if (!locs.length && empSession && empSession.data && empSession.data.location) locs = [empSession.data.location];

  var matched = null, minJarak = 0, bestMatchJarak = Infinity;
  if (locs.length) {
    minJarak = Infinity;
    locs.forEach(function(l) {
      var d = calcDistance(pos.coords.latitude, pos.coords.longitude, l.latitude, l.longitude);
      if (d < minJarak) minJarak = d;
      if (d <= l.radius_meter && d < bestMatchJarak) { bestMatchJarak = d; matched = l; }
    });
  }

  var inRad = !locs.length || !!matched;
  var finalJarak = matched ? bestMatchJarak : (minJarak === Infinity ? 0 : minJarak);
  currentGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude, jarak: finalJarak, inRadius: inRad, matchedLoc: matched };

  if (inRad) {
    lastGpsStatus = matched ? ('Di dalam area ' + matched.nama_lokasi) : 'GPS aktif';
    box.className = 'gps-box gps-ok';
    title.textContent = 'Di Dalam Area Tugas (Siap Presensi)';
    desc.textContent = matched ? ('Lokasi terverifikasi: ' + matched.nama_lokasi + ' (' + matched.kota + ')') : 'Lokasi GPS terverifikasi.';
  } else {
    lastGpsStatus = 'Di luar area tugas';
    box.className = 'gps-box gps-err';
    title.textContent = 'Di Luar Area Tugas';
    desc.textContent = hasFeature('people_dinas_luar')
      ? 'Presensi kantor tidak tersedia. Gunakan MENU DINAS LUAR di bawah.'
      : 'Anda berada di luar area tugas. Harap masuk ke area kantor untuk presensi.';
  }
  updateEmpButtons();
}

function handleGpsError() {
  var box = document.getElementById('gps-box'), title = document.getElementById('gps-title'), desc = document.getElementById('gps-desc');
  currentGPS = null;
  lastGpsStatus = 'GPS gagal terbaca / belum diizinkan';
  box.className = 'gps-box gps-err';
  title.textContent = 'GPS Gagal Terbaca';
  desc.textContent = 'Nyalakan GPS HP dan izinkan browser mengakses lokasi, lalu tekan tombol di bawah.';
  updateEmpButtons();
}

function startLiveGPS() {
  if (!navigator.geolocation) { handleGpsError(); return; }
  if (gpsWatchId !== null) return;
  gpsWatchId = navigator.geolocation.watchPosition(handleGpsSuccess, handleGpsError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
  });
}

function refreshGPS() {
  var box = document.getElementById('gps-box'), title = document.getElementById('gps-title'), desc = document.getElementById('gps-desc');
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  currentGPS = null;
  lastGpsStatus = 'Sedang mencari GPS';
  box.className = 'gps-box'; title.textContent = 'Mencari titik GPS...'; desc.textContent = 'Mohon tunggu sebentar.';
  updateEmpButtons();
  startLiveGPS();
}

// ===== KAMERA & SUBMIT PRESENSI =====
function showEmpMsg(msg, ok) {
  var el = document.getElementById('emp-msg');
  el.textContent = msg; el.className = 'alert ' + (ok ? 'alert-ok' : 'alert-err'); el.classList.remove('hidden');
}

function startPresensi(tipe, isDinasLuar) {
  document.getElementById('emp-msg').classList.add('hidden');
  if (!currentGPS) { showEmpMsg('Aktifkan GPS di atas terlebih dahulu.', false); return; }
  if (isDinasLuar && !hasFeature('people_dinas_luar')) { showEmpMsg('Fitur Dinas Luar tidak aktif.', false); return; }
  if (!isDinasLuar && !currentGPS.inRadius) { showEmpMsg('DITOLAK: Di luar lokasi tugas.', false); updateEmpButtons(); return; }
  if (isDinasLuar && !document.getElementById('dl-ket').value.trim()) { showEmpMsg('Isi tujuan Dinas Luar dulu.', false); return; }
  pendingType = tipe; pendingIsDL = isDinasLuar;
  var inp = document.getElementById('camera-input'); inp.value = ''; inp.click();
}

function fileToCanvas(file, cb) {
  var r = new FileReader();
  r.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var scale = img.width > 640 ? (640 / img.width) : 1;
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c);
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}

function uploadDrive(url, payload, attempt, done) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res && res.status === 'success') done(null, res.url);
      else if (attempt < 3) setTimeout(function() { uploadDrive(url, payload, attempt + 1, done); }, 2000);
      else done('Gagal upload foto');
    }).catch(function() {
      if (attempt < 3) setTimeout(function() { uploadDrive(url, payload, attempt + 1, done); }, 2000);
      else done('Koneksi terganggu');
    });
}

function onPhotoCaptured(e) {
  var file = e.target.files[0]; if (!file) return;
  var tipeNow = pendingType;
  var isDlNow = pendingIsDL;
  var faceOn = hasFeature('people_face_rec') && empSession.data.employee && empSession.data.employee.face_rec_enabled !== false;

  showOverlay('loading', 'JANGAN TUTUP HALAMAN INI', faceOn ? 'Memverifikasi wajah & mencatat jam presensi...' : 'Mencatat jam presensi Anda...');
  ['btn-masuk', 'btn-pulang', 'btn-dl-masuk', 'btn-dl-pulang'].forEach(function(id) { document.getElementById(id).disabled = true; });

  fileToCanvas(file, function(canvas) {
    verifyFaceOnCanvas(canvas).then(function(faceRes) {
      var actualLoc = currentGPS.matchedLoc || empSession.data.location;
      var locName = isDlNow ? 'DINAS_LUAR' : (actualLoc ? actualLoc.nama_lokasi : 'Tanpa_Lokasi');
      var dlText = document.getElementById('dl-ket').value.trim();
      var wmLoc = isDlNow ? ('DINAS LUAR: ' + dlText) : (actualLoc ? (actualLoc.nama_lokasi + ' (' + actualLoc.kota + ')') : 'GPS Terverifikasi');
      var ket = isDlNow ? ('[DINAS LUAR] ' + dlText) : '';

      sb.rpc('hris_emp_submit_attendance', {
        p_nik: empSession.nik, p_pin: empSession.pin, p_tipe: tipeNow,
        p_lat: currentGPS.lat, p_lng: currentGPS.lng, p_jarak: currentGPS.jarak,
        p_foto_url: '', p_keterangan: ket,
        p_location_id: (!isDlNow && currentGPS.matchedLoc) ? currentGPS.matchedLoc.id : null,
        p_face_status: faceRes.status,
        p_face_distance: faceRes.distance,
        p_new_descriptor: faceRes.newDescriptor || null,
        p_company_slug: tenantContext.slug,
        p_domain: tenantContext.domain
      }).then(function(res) {
        var d = res.data;
        if (res.error || !d || !d.ok) {
          hideOverlay();
          showEmpMsg(d && d.message ? d.message : 'Gagal simpan presensi', false);
          updateEmpButtons();
          return;
        }

        if (faceRes.newDescriptor) empSession.data.employee.face_descriptor = faceRes.newDescriptor;
        document.getElementById('dl-ket').value = '';
        var attId = d.attendance_id;
        var webhook = empSession.data.settings ? empSession.data.settings.drive_webhook_url : '';
        var secret = empSession.data.settings ? empSession.data.settings.drive_secret : '';
        var labelSukses = (isDlNow ? 'Dinas Luar ' : 'Presensi ') + tipeNow;

        function finishFlow(noteSub) {
          showOverlay('success', 'PRESENSI BERHASIL!', noteSub);
          showEmpMsg('BERHASIL! ' + labelSukses + ' tercatat.', true);
          callEmpLogin(empSession.nik, empSession.pin, true);
        }

        if (webhook && webhook.indexOf('script.google.com') !== -1 && attId) {
          showOverlay('loading', 'JANGAN TUTUP HALAMAN INI', 'Jam sudah tercatat! Mengirim foto bukti...');
          if (hasFeature('people_watermark_foto')) {
            drawWatermarkOnCanvas(canvas, empSession.data.employee.nama_lengkap, wmLoc, tipeNow);
          }
          var base64 = canvas.toDataURL('image/jpeg', 0.68);
          uploadDrive(webhook, {
            secret: secret, lokasi: locName, tipe: tipeNow,
            namaKaryawan: empSession.data.employee.nama_lengkap, imageBase64: base64
          }, 1, function(err, url) {
            if (!err && url) {
              sb.rpc('hris_emp_attach_photo', {
                p_nik: empSession.nik, p_pin: empSession.pin,
                p_att_id: attId, p_tipe: tipeNow, p_foto_url: url,
                p_company_slug: tenantContext.slug, p_domain: tenantContext.domain
              }).then(function() {
                finishFlow(labelSukses + ' dan foto bukti sudah tersimpan.');
              });
            } else {
              finishFlow(labelSukses + ' sudah tersimpan (foto tertunda karena sinyal).');
            }
          });
        } else {
          finishFlow(labelSukses + ' sudah tersimpan di sistem.');
        }
      });
    });
  });
}

function logoutEmp() {
  if (!confirm('Yakin keluar akun? Nanti Anda harus memasukkan NIK KTP & PIN lagi untuk masuk.')) return;
  if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
  localStorage.removeItem(getEmpStorageKey());
  localStorage.removeItem('hris_emp_cred');
  location.reload();
}
