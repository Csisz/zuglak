/* Zuglak Studio 2.0 – consistent 24px stroke icon set (drawn for this project). */
(function (root) {
  'use strict';
  const paths = {
    chevron: '<path d="m6 9 6 6 6-6"/>',
    plan: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h7v9M14 3v7h7"/>',
    cube: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9.2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/><path d="M10 3v8a2 2 0 0 0 4 0V3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M4 3h16"/>',
    present: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="m10 8.5 4.5 2.5-4.5 2.5z"/><path d="M8 21h8M12 17v4"/>',
    sofa: '<path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M5 18v2M19 18v2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    'lock-open': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    cursor: '<path d="m5 3 14 7-6 2-2 6z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7"/><path d="M17 13a5 5 0 0 1-5 8h-1a6 6 0 0 1-5-2.7L4 15a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
    measure: '<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    walls: '<path d="M3 21V9l9-6 9 6v12"/><path d="M3 14h18"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
    rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    'rotate-left': '<path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    wall: '<path d="M3 5h18v14H3z"/><path d="M3 12h18M8 5v7M16 5v7M12 12v7"/>',
    door: '<path d="M5 21V3h9v18"/><path d="M14 21a9 9 0 0 0-9-9"/>',
    window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
    radiator: '<path d="M5 6v12M9 6v12M13 6v12M17 6v12M3 18h18"/>',
    opening: '<path d="M3 20V6M21 20V6"/><path d="M7 20h10" stroke-dasharray="2 2"/>',
    align: '<path d="M4 4v16"/><rect x="7" y="6" width="10" height="4" rx="1"/><rect x="7" y="14" width="6" height="4" rx="1"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    pin: '<path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'
  };
  function svg(name, className = '') {
    const body = paths[name] || paths.info;
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  function hydrate(scope = document) {
    scope.querySelectorAll('i[data-icon]').forEach(node => {
      node.outerHTML = svg(node.dataset.icon, node.className);
    });
  }
  root.ZuglakIcons = Object.freeze({ svg, hydrate, names: Object.keys(paths) });
})(typeof globalThis !== 'undefined' ? globalThis : this);
