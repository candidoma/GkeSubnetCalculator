/*
 * GKE Subnet Calculator - logica di calcolo
 * Formule allineate alla documentazione ufficiale Google Kubernetes Engine:
 * https://docs.cloud.google.com/kubernetes-engine/docs/how-to/flexible-pod-cidr
 *
 * Nomenclatura ufficiale:
 *   Q  = max Pod per nodo        S  = prefisso subnet principale
 *   DS = prefisso subnet Pod     M  = 31 - ceil(log2(Q))  (CIDR per nodo)
 *   HM = 32 - M                  HD = 32 - DS
 *   MN = 2^(HD - HM)  (max nodi) MP = MN * Q  (max pod)
 *   N  = 2^(32 - S) - 4  (IP utilizzabili subnet principale)
 */
'use strict';

var GCP_RESERVED_IPS = 4;
var GKE_MAX_PODS_PER_NODE = 512;
var GKE_MIN_POD_RANGE_PREFIX = 24; // minimo per pool di nodi
var GKE_MIN_SERVICE_PREFIX = 28;

/* ---- funzioni di dominio pure ---- */

// M = 31 - ceil(log2(Q)) : prefisso del blocco Pod per ciascun nodo.
function perNodePrefix(q) {
  return 31 - Math.ceil(Math.log2(q));
}

// Prefisso CIDR piu' piccolo capace di contenere "hosts" indirizzi.
function prefixForHosts(hosts) {
  if (hosts < 1) hosts = 1;
  return 32 - Math.ceil(Math.log2(hosts));
}

// N = 2^(32 - S) - 4
function usablePrimaryIps(s) {
  return Math.pow(2, 32 - s) - GCP_RESERVED_IPS;
}

// MN = 2^(HD - HM)
function maxNodesForPodRange(q, ds) {
  var m = perNodePrefix(q);
  var hm = 32 - m;
  var hd = 32 - ds;
  return Math.max(Math.pow(2, hd - hm), 1);
}

function clusterNodes(maxNodes, surge) {
  return maxNodes + surge;
}

/* ---- calcolo completo del dimensionamento ---- */

function computeSizing(input) {
  var q = input.q;
  var nodes = clusterNodes(input.maxNodes, input.surge);
  var totalPods = q * nodes;

  // Blocco per nodo
  var pernodePrefix = perNodePrefix(q);
  var pernodeIps = Math.pow(2, 32 - pernodePrefix);

  // Subnet principale: nodi + LB interni + riservati GCP
  var primaryPrefix = prefixForHosts(nodes + input.lb + GCP_RESERVED_IPS);
  var primaryUsable = usablePrimaryIps(primaryPrefix);

  // Intervallo Pod: copre tutti i pod, ma min /24 per node pool
  var podPrefixIdeal = prefixForHosts(totalPods);
  var podPrefix = Math.min(GKE_MIN_POD_RANGE_PREFIX, podPrefixIdeal);
  var podIps = Math.pow(2, 32 - podPrefix);
  var podMaxNodes = maxNodesForPodRange(q, podPrefix);
  var podMaxPods = podMaxNodes * q;
  var podClamped = podPrefixIdeal > GKE_MIN_POD_RANGE_PREFIX;

  // Intervallo Service: su numero nodi, minimo /28
  var svcPrefixIdeal = prefixForHosts(Math.max(nodes, 16));
  var svcPrefix = Math.min(GKE_MIN_SERVICE_PREFIX, svcPrefixIdeal);
  var svcIps = Math.pow(2, 32 - svcPrefix);

  return {
    nodes: nodes,
    totalPods: totalPods,
    pernodePrefix: pernodePrefix,
    pernodeIps: pernodeIps,
    primaryPrefix: primaryPrefix,
    primaryUsable: primaryUsable,
    primaryReq: nodes + input.lb,
    podPrefix: podPrefix,
    podIps: podIps,
    podMaxNodes: podMaxNodes,
    podMaxPods: podMaxPods,
    podClamped: podClamped,
    svcPrefix: svcPrefix,
    svcIps: svcIps
  };
}

/* ---- formattazione ---- */

var nf = new Intl.NumberFormat('it-IT');
function fmt(n) { return nf.format(n); }

/* ---- validazione input ---- */

function readInputs() {
  var fields = {
    q: { el: 'q', min: 1, max: GKE_MAX_PODS_PER_NODE, box: 'field-q' },
    maxNodes: { el: 'maxNodes', min: 1, max: Infinity, box: 'field-nodes' },
    surge: { el: 'surge', min: 0, max: Infinity, box: 'field-surge' },
    lb: { el: 'lb', min: 0, max: Infinity, box: 'field-lb' }
  };
  var values = {};
  var ok = true;
  Object.keys(fields).forEach(function (key) {
    var cfg = fields[key];
    var input = document.getElementById(cfg.el);
    var box = document.getElementById(cfg.box);
    var v = parseInt(input.value, 10);
    var valid = Number.isFinite(v) && v >= cfg.min && v <= cfg.max;
    box.classList.toggle('invalid', !valid);
    if (!valid) { ok = false; } else { values[key] = v; }
  });
  return ok ? values : null;
}

/* ---- rendering ---- */

function render() {
  var input = readInputs();
  if (!input) return; // input non valido: non aggiorna i risultati

  var r = computeSizing(input);

  setText('r-nodes', fmt(r.nodes));
  setText('r-pods', fmt(r.totalPods));

  setText('r-pernode-cidr', '/' + r.pernodePrefix);
  setText('r-pernode-ips', fmt(r.pernodeIps));

  setText('r-primary-cidr', '/' + r.primaryPrefix);
  setText('r-primary-usable', fmt(r.primaryUsable));
  setText('r-primary-req', fmt(r.primaryReq));

  setText('r-pod-cidr', '/' + r.podPrefix);
  setText('r-pod-ips', fmt(r.podIps));
  setText('r-pod-mn', fmt(r.podMaxNodes));
  setText('r-pod-mp', fmt(r.podMaxPods));

  var warn = document.getElementById('pod-warn');
  if (r.podClamped) {
    warn.style.display = 'block';
    warn.innerHTML = 'I Pod totali richiederebbero un intervallo piu' +
      ' piccolo di /24, ma GKE impone almeno <strong>/24</strong> per node pool. ' +
      'Il prefisso e\u0300 stato limitato: per cluster piu\u0300 piccoli usa ' +
      '<code>--cluster-ipv4-cidr</code> a livello cluster, oppure il CIDR multi-pod non contiguo.';
  } else {
    warn.style.display = 'none';
  }

  setText('r-svc-cidr', '/' + r.svcPrefix);
  setText('r-svc-ips', fmt(r.svcIps));

  // Riquadro riepilogo: i CIDR da configurare (output principale)
  setText('s-primary', '/' + r.primaryPrefix);
  setText('s-pod', '/' + r.podPrefix);
  setText('s-svc', '/' + r.svcPrefix);
  setText('s-pernode', '/' + r.pernodePrefix);

  highlightRefTables(input.q, r.podPrefix);
}

function setText(id, text) { document.getElementById(id).textContent = text; }

/* ---- tabelle di riferimento (statiche + evidenziazione) ---- */

var PERNODE_TABLE = [
  { q: '8', cidr: 28, ips: 16, qmin: 8, qmax: 8 },
  { q: '9-16', cidr: 27, ips: 32, qmin: 9, qmax: 16 },
  { q: '17-32', cidr: 26, ips: 64, qmin: 17, qmax: 32 },
  { q: '33-64', cidr: 25, ips: 128, qmin: 33, qmax: 64 },
  { q: '65-128', cidr: 24, ips: 256, qmin: 65, qmax: 128 },
  { q: '129-256', cidr: 23, ips: 512, qmin: 129, qmax: 256 },
  { q: '257-512', cidr: 22, ips: 1024, qmin: 257, qmax: 512 }
];

function buildRefTables() {
  var tb = document.querySelector('#table-pernode tbody');
  PERNODE_TABLE.forEach(function (row) {
    var tr = document.createElement('tr');
    tr.dataset.qmin = row.qmin;
    tr.dataset.qmax = row.qmax;
    tr.innerHTML = '<td>' + row.q + '</td><td class="cidr">/' + row.cidr +
      '</td><td>' + fmt(row.ips) + '</td>';
    tb.appendChild(tr);
  });

  // La colonna "Max Nodi/Pod" dipende da Q, quindi viene (ri)calcolata a runtime.
  renderPodRangeTable();
}

function renderPodRangeTable() {
  var q = parseInt(document.getElementById('q').value, 10);
  if (!Number.isFinite(q) || q < 1) q = 32;
  var tb = document.querySelector('#table-podrange tbody');
  tb.innerHTML = '';
  for (var ds = 24; ds >= 11; ds--) {
    var ips = Math.pow(2, 32 - ds);
    var mn = maxNodesForPodRange(q, ds);
    var mp = mn * q;
    var tr = document.createElement('tr');
    tr.dataset.ds = ds;
    tr.innerHTML = '<td class="cidr">/' + ds + '</td><td>' + fmt(ips) +
      '</td><td>' + fmt(mn) + '</td><td>' + fmt(mp) + '</td>';
    tb.appendChild(tr);
  }
}

function highlightRefTables(q, podPrefix) {
  renderPodRangeTable(); // dipende da Q
  document.querySelectorAll('#table-pernode tbody tr').forEach(function (tr) {
    var on = q >= +tr.dataset.qmin && q <= +tr.dataset.qmax;
    tr.classList.toggle('hl', on);
  });
  document.querySelectorAll('#table-podrange tbody tr').forEach(function (tr) {
    tr.classList.toggle('hl', +tr.dataset.ds === podPrefix);
  });
}

/* ---- copia negli appunti ---- */

function copyCidr(btn) {
  var text = btn.textContent.trim();
  if (!text || text === '\u2014') return;
  var done = function () {
    var prev = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = 'copiato \u2713';
    setTimeout(function () {
      btn.classList.remove('copied');
      btn.textContent = prev;
    }, 900);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallbackCopy.bind(null, text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* no-op */ }
  document.body.removeChild(ta);
}

/* ---- init ---- */

document.addEventListener('DOMContentLoaded', function () {
  buildRefTables();
  ['q', 'maxNodes', 'surge', 'lb'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
  });
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () { copyCidr(btn); });
  });
  render();
});
