// ===== KUNCI SUPABASE (CUKUP ISI SEKALI DI SINI) =====
var SUPABASE_URL = 'https://mqtirqxmballmerllifu.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xdGlycXhtYmFsbG1lcmxsaWZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNTYzMTUsImV4cCI6MjExMDYzMjMxNX0.T4kVEg2SNpLWB19CEv9FYFgbVkvZl806834AUXn9YZw';

var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== KONTEKS TENANT & HELPER BERSAMA =====
var tenantContext = { slug: null, domain: null };

function detectTenant() {
  var params = new URLSearchParams(window.location.search);
  var slugParam = (params.get('c') || '').trim().toLowerCase();
  var host = (window.location.hostname || '').toLowerCase();
  tenantContext.slug = slugParam || null;
  tenantContext.domain = (host && host !== 'localhost' && host !== '127.0.0.1' && host.indexOf('.vercel.app') === -1) ? host : null;
}

function getTodayWIB() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function getHHMMWIB(iso) {
  return iso ? new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(11, 16) : '';
}

function getDateWIB(iso) {
  return iso ? new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10) : '';
}

function formatTimeWIB(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
}

function addDaysStr(ymd, days) {
  var p = ymd.split('-');
  return new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + days)).toISOString().slice(0, 10);
}

function countDaysInclusive(d1, d2) {
  if (!d1 || !d2 || d2 < d1) return 1;
  var p1 = d1.split('-'), p2 = d2.split('-');
  var t1 = Date.UTC(parseInt(p1[0], 10), parseInt(p1[1], 10) - 1, parseInt(p1[2], 10));
  var t2 = Date.UTC(parseInt(p2[0], 10), parseInt(p2[1], 10) - 1, parseInt(p2[2], 10));
  return Math.round((t2 - t1) / 86400000) + 1;
}

function formatDateRange(start, end) {
  if (!end || end <= start) return start;
  return start + ' s/d ' + end + ' (' + countDaysInclusive(start, end) + ' hr)';
}

function isNonWorkStatus(st) {
  return st === 'IZIN' || st === 'SAKIT' || st === 'CUTI';
}

function isLupaPulang(a, isShift24) {
  var maxHours = isShift24 ? 28 : 16;
  return !isNonWorkStatus(a.status) && !a.jam_pulang && a.jam_masuk && ((Date.now() - new Date(a.jam_masuk).getTime()) > maxHours * 3600 * 1000);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWaNumber(raw) {
  var wa = String(raw || '').replace(/\D/g, '');
  if (wa.indexOf('0') === 0) wa = '62' + wa.slice(1);
  return wa;
}

function downloadCSV(name, rows) {
  var csv = rows.map(function(r) {
    return r.map(function(c) {
      return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = name;
  a.click();
}
