/* Phase 1 task sets, matching the experimental plan's four task types:
   (1) trace and colour an icon, (2) scene from a reference, (3) edit a provided messy sketch,
   (4) layered illustration with 3+ layers. Three sessions, one of each type per session, ~50 min each.

   Task fields: id, title, prompt, steps[], image (reference shown in the panel), estMin,
   startLayers [{name, image, opacity}] put on the canvas at task start (bottom→top, last one active),
   newLayers [names] blank layers added on top (last one becomes active). */
(function (MP) {
  'use strict';

  const svg = (body, defs = '') =>
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs>${defs}</defs><rect width="800" height="500" fill="#ffffff"/>${body}</svg>`);
  const transparent = (body) =>
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">${body}</svg>`);

  /* Icons are lists of [svg element, fill colour]; the trace version drops the fills. */
  const star = (cx, cy, r) => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
    }
    return `<path d="${d}Z"/>`;
  };
  const gear = (cx, cy, r, teeth) => {
    let d = '';
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i * Math.PI) / teeth, a1 = ((i + 1) * Math.PI) / teeth, rr = i % 2 ? r * 0.78 : r;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a0) * rr).toFixed(1) + ' ' + (cy + Math.sin(a0) * rr).toFixed(1) +
        'L' + (cx + Math.cos(a1) * rr).toFixed(1) + ' ' + (cy + Math.sin(a1) * rr).toFixed(1);
    }
    return `<path d="${d}Z"/>`;
  };
  const icon = (parts, colored) =>
    (colored ? svg : transparent)(
      `<g stroke="#151515" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${parts
        .map(([shape, fill]) => shape.replace(/^<(\w+)/, `<$1 fill="${colored && fill ? fill : 'none'}"`))
        .join('')}</g>`);

  const ROCKET = [
    ['<circle cx="400" cy="250" r="205"/>', '#24346e'],
    ['<circle cx="400" cy="250" r="178"/>', '#3557b7'],
    [star(255, 150, 26), '#ffd23f'],
    [star(548, 345, 20), '#ffd23f'],
    [star(560, 160, 14), '#ffd23f'],
    ['<path d="M372 302c4 40 16 62 28 88 12-26 24-48 28-88z"/>', '#f39c12'],
    ['<path d="M384 302c3 24 9 38 16 54 7-16 13-30 16-54z"/>', '#ffe066'],
    ['<path d="M342 236L292 300l52-6z"/>', '#e74c3c'],
    ['<path d="M458 236l50 64-52-6z"/>', '#e74c3c'],
    ['<path d="M400 92c58 46 78 120 62 210H338c-16-90 4-164 62-210z"/>', '#f2f2f2'],
    ['<path d="M352 140h96" />', null],
    ['<circle cx="400" cy="200" r="28"/>', '#6ec6ff'],
    ['<path d="M380 302v26M400 302v26M420 302v26"/>', null],
  ];
  const CAMERA = [
    ['<rect x="170" y="140" width="460" height="290" rx="36"/>', '#3d3f46'],
    ['<path d="M300 140l28-52h144l28 52z"/>', '#55585f'],
    ['<rect x="200" y="112" width="70" height="28" rx="8"/>', '#55585f'],
    ['<rect x="170" y="200" width="460" height="70"/>', '#8a6b4f'],
    ['<circle cx="400" cy="290" r="112"/>', '#1d1e22'],
    ['<circle cx="400" cy="290" r="82"/>', '#2c6fb3'],
    ['<circle cx="400" cy="290" r="46"/>', '#0e2a47'],
    ['<circle cx="378" cy="268" r="14"/>', '#e8f4ff'],
    ['<rect x="540" y="162" width="62" height="26" rx="6"/>', '#ffd23f'],
    ['<circle cx="220" cy="172" r="12"/>', '#e74c3c'],
  ];
  const BULB = [
    ['<path d="M400 60c-95 0-160 70-160 150 0 60 35 95 62 125 18 20 28 40 28 62h140c0-22 10-42 28-62 27-30 62-65 62-125 0-80-65-150-160-150z"/>', '#fff3a6'],
    [gear(400, 205, 78, 9), '#f39c12'],
    ['<circle cx="400" cy="205" r="30"/>', '#fff3a6'],
    ['<rect x="330" y="397" width="140" height="26" rx="8"/>', '#9aa3ad'],
    ['<rect x="338" y="423" width="124" height="24" rx="8"/>', '#7d8791'],
    ['<path d="M372 447h56l-10 22h-36z"/>', '#4b535b'],
    ['<path d="M170 210h-40M630 210h40M220 80l-28-28M580 80l28-28M400 20V-10"/>', null],
  ];

  /* ---------- landscape references ---------- */
  const LAKE = svg(`
    <rect width="800" height="300" fill="url(#sk)"/>
    <circle cx="560" cy="230" r="48" fill="#ffd27a"/>
    <path d="M0 300L130 150l70 70 110-140 120 150 90-90 130 120 150-110v150z" fill="#5b4a7a"/>
    <path d="M310 80l-38 48 22-6 16 22 18-26 22 8z" fill="#fff"/><path d="M130 150l-26 30 18-4 10 14 12-18 14 6z" fill="#fff"/>
    <path d="M0 300l170-80 120 60 160-90 140 80 210-60v90z" fill="#3e3561"/>
    <rect y="300" width="800" height="200" fill="url(#lk)"/>
    <path d="M0 300L130 420l70-60 110 140H0z" fill="#3e3561" opacity=".45"/>
    <rect x="520" y="310" width="80" height="6" fill="#ffd27a" opacity=".8"/><rect x="535" y="330" width="50" height="5" fill="#ffd27a" opacity=".6"/><rect x="545" y="350" width="30" height="4" fill="#ffd27a" opacity=".5"/>
    <g fill="#1f2a2a"><path d="M40 300l22-80 22 80z"/><path d="M75 300l18-60 18 60z"/><path d="M700 300l24-90 24 90z"/><path d="M740 300l18-60 18 60z"/></g>`,
    '<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4c9a"/><stop offset=".6" stop-color="#f08a5d"/><stop offset="1" stop-color="#ffd27a"/></linearGradient><linearGradient id="lk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e07a5f"/><stop offset="1" stop-color="#2c3e66"/></linearGradient>');
  const CANYON = svg(`
    <rect width="800" height="500" fill="url(#ds)"/>
    <circle cx="660" cy="90" r="40" fill="#fff6c9"/>
    <path d="M0 330V200h90l20-30h120l15 30h40v130z" fill="#c4562f"/>
    <path d="M0 220h285M30 260h240" stroke="#9e3f1f" stroke-width="5"/>
    <path d="M470 330V170h60l20-40h120l20 40h130v160z" fill="#b5482a"/>
    <path d="M480 210h320M500 260h300" stroke="#8e351b" stroke-width="5"/>
    <path d="M0 330c150-30 300 20 420-10s260-20 380 5v175H0z" fill="#e9b872"/>
    <path d="M0 400c180-40 340 30 520 0s200-10 280 10v90H0z" fill="#d79f5a"/>
    <g fill="#3f8f4f" stroke="#2c6a39" stroke-width="3"><path d="M200 420v-90a14 14 0 0128 0v90z"/><path d="M200 380h-22v-30a10 10 0 0120 0v12h2z"/><path d="M228 370h20v-28a10 10 0 00-20 0z"/>
    <path d="M600 450v-70a11 11 0 0122 0v70z"/><path d="M600 420h-16v-22a8 8 0 0116 0z"/></g>`,
    '<linearGradient id="ds" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8fd6"/><stop offset="1" stop-color="#bfe3ff"/></linearGradient>');
  const CABIN = svg(`
    <rect width="800" height="500" fill="url(#ns)"/>
    <circle cx="640" cy="80" r="34" fill="#f3f0d8"/><circle cx="652" cy="72" r="30" fill="#24305e"/>
    <g fill="#fff" opacity=".8"><circle cx="100" cy="60" r="2"/><circle cx="220" cy="110" r="2"/><circle cx="360" cy="50" r="2"/><circle cx="480" cy="130" r="1.5"/><circle cx="740" cy="160" r="2"/></g>
    <path d="M0 340c200-40 400-30 800 10v150H0z" fill="#e9eef7"/>
    <rect x="300" y="250" width="200" height="120" fill="#7a4b2a"/>
    <path d="M280 255l120-80 120 80z" fill="#5a2f17"/><path d="M276 258l124-86 124 86-12 4-112-76-112 76z" fill="#fff"/>
    <rect x="340" y="290" width="44" height="36" fill="#ffcf5a"/><rect x="430" y="300" width="40" height="70" fill="#4a2a14"/>
    <rect x="450" y="180" width="22" height="50" fill="#5a2f17"/>
    <path d="M462 172c-10-20 14-24 4-44s16-26 8-44" stroke="#cfd6e6" stroke-width="8" fill="none" stroke-linecap="round" opacity=".7"/>
    <g fill="#1e4d3a"><path d="M90 360l50-150 50 150z"/><path d="M180 350l40-120 40 120z"/><path d="M590 360l46-140 46 140z"/><path d="M680 365l40-110 40 110z"/></g>
    <g fill="#fff"><path d="M118 280l22-66 22 66-22-10z"/><path d="M200 290l20-56 20 56-20-8z"/><path d="M614 290l22-66 22 66-22-10z"/></g>
    <path d="M330 326h70" stroke="#ffcf5a" stroke-width="4" opacity=".5"/>`,
    '<linearGradient id="ns" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121a3a"/><stop offset="1" stop-color="#3a4f8a"/></linearGradient>');

  /* ---------- messy sketches: rough pencil start canvas + clean colored target ----------
     Each scene function builds the drawing twice: fixed=false gives the rough sketch (mistakes in place),
     fixed=true the corrected target. f(color) returns the fill attribute so shapes are shared. */
  const ROUGH = '<filter id="w1" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>' +
    '<filter id="w2" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale="11"/></filter>';
  const GUIDES = (d) => `<g fill="none" stroke="#c9c9c9" stroke-width="1.5">${d}</g>`;
  const SCRIBBLE = (d) => `<g fill="none" stroke="#7a7a7a" stroke-width="2.5" stroke-linecap="round" filter="url(#w1)">${d}</g>`;
  /* wrong: the wrongly colored patch (drawn under the lines); extras: guides + scribbles (drawn on top) */
  const roughSketch = (lines, wrong, extras) => transparent(`<defs>${ROUGH}</defs>
    <g filter="url(#w1)" opacity=".85">${wrong}</g>
    <g fill="none" stroke="#a8a8a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter="url(#w2)" transform="translate(3 2)">${lines}</g>
    <g fill="none" stroke="#3c3c3c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#w1)">${lines}</g>${extras}`);
  const cleanTarget = (body) => svg(`<g stroke="#1e1e1e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
  const messyPair = (scene, wrong, extras) => ({
    sketch: roughSketch(scene(() => 'fill="none"', false), wrong, extras),
    target: cleanTarget(scene((c) => `fill="${c}"`, true)),
  });

  const cafe = (f, fixed) => {
    const steamX = fixed ? 0 : 290, plantY = fixed ? 0 : -165;
    const leaf = fixed ? 'stroke="#2f7d3a"' : '';
    return `<path d="M40 400h720"/>
      <ellipse cx="300" cy="392" rx="130" ry="22" ${f('#3d7fd6')}/>
      <path d="M220 250h160l-18 130c-2 12-12 18-24 18h-76c-12 0-22-6-24-18z" ${f('#f4efe6')}/>
      <ellipse cx="300" cy="250" rx="80" ry="14" ${f('#6b3f24')}/>
      ${fixed ? '<path d="M380 280c40-6 52 36 22 52c-6 6-14 8-24 8" fill="none"/>' : '<path d="M380 280c40-6 52 36 22 48"/><path d="M396 352c-6 3-12 4-18 3"/>'}
      <path d="M270 225c-10-24 14-30 4-56M300 225c-10-24 14-30 4-56M330 225c-10-24 14-30 4-56" fill="none" transform="translate(${steamX} 0)"/>
      ${fixed ? `<path d="M70 396l66-26" fill="none"/><ellipse cx="146" cy="366" rx="16" ry="9" transform="rotate(-23 146 366)" ${f('#c0c4c8')}/>`
        : '<path d="M120 330l230-120" stroke-width="10"/><ellipse cx="372" cy="198" rx="38" ry="22" transform="rotate(-28 372 198)"/>'}
      ${(fixed ? [470, 520, 570] : [520]).map((x) => `<circle cx="${x}" cy="378" r="22" ${f('#d9a35b')}/><circle cx="${x - 7}" cy="372" r="3" ${f('#5b3a1e')}/><circle cx="${x + 7}" cy="384" r="3" ${f('#5b3a1e')}/>`).join('')}
      <g transform="translate(0 ${plantY})"><path d="M640 400l-14-80h88l-14 80z" ${f('#c8794a')}/><path d="M670 320c-20-40 0-80 30-90M670 320c10-50 50-70 70-60M670 320c-40-20-50-60-40-80" fill="none" ${leaf}/></g>`;
  };
  const CAFE = messyPair(cafe,
    '<ellipse cx="300" cy="392" rx="132" ry="24" fill="#d9363e"/>',
    GUIDES('<circle cx="300" cy="310" r="125"/><path d="M300 160v260M150 250h300M150 392h300"/>') +
    SCRIBBLE('<path d="M80 120l30-20 20 30 30-25 20 30 25-20"/><path d="M450 70c30 10 60-20 90 0s50 10 70-10"/><path d="M90 470l40-25 30 25 35-30"/><path d="M450 300l30 30M440 330l40-30"/>'));

  const house = (f, fixed) => {
    const treeX = fixed ? 650 : 140;
    const trunk = fixed ? 'stroke="#6b4423"' : '';
    const cloud = (dx, dy) => `<path d="M120 120c0-20 30-30 40-14 10-20 46-16 46 8 20 0 26 26 6 32h-86c-20-2-24-24-6-26z" transform="translate(${dx} ${dy})" ${f('#ffffff')}/>`;
    return `<path d="M30 420h740"/>
      ${fixed ? `<rect x="460" y="168" width="28" height="60" ${f('#8d5a3b')}/>` : ''}
      <rect x="300" y="250" width="220" height="170" ${f('#f1e2c4')}/>
      <path d="M280 255l130-100 130 100z" ${f('#c0392b')}/>
      ${fixed ? `<rect x="386" y="340" width="44" height="80" ${f('#7a4b2a')}/>` : '<path d="M380 420v-80l46-6 6 86"/>'}
      <rect x="320" y="280" width="44" height="40" ${f('#9fd3ff')}/><rect x="456" y="280" width="44" height="40" ${f('#9fd3ff')}/>
      ${fixed ? `<circle cx="715" cy="70" r="36" ${f('#ffd23f')}/>` : '<circle cx="600" cy="130" r="95"/>'}
      <g transform="translate(${treeX} 0)"><path d="M0 420v-90" stroke-width="12" ${trunk}/><circle cx="0" cy="290" r="60" ${f('#3f8f4f')}/></g>
      ${cloud(0, 0)}${fixed ? cloud(190, -40) + cloud(330, 10) : ''}`;
  };
  const HOUSE = messyPair(house,
    '<path d="M276 258l134-106 134 106z" fill="#4caf50"/>',
    GUIDES('<path d="M410 140v290M260 255h300"/><rect x="290" y="240" width="240" height="190"/>') +
    SCRIBBLE('<path d="M560 330l20 20 20-20 20 20 20-20"/><path d="M330 360c20-10 30 10 50 0"/><path d="M40 60l60 40M60 40l20 70"/><path d="M600 470c40-20 80 10 120-10"/>'));

  const fruit = (f, fixed) => {
    const pear = `<path d="M650 410c-30 0-46-26-40-56 4-24 16-30 18-52 2-14 30-14 32 0 2 22 14 28 18 52 6 30-10 56-40 56z" ${f('#c9d84a')} transform="translate(${fixed ? '-190 -112' : '0 0'})"/>`;
    const banana = fixed ? `<path d="M370 250c40-50 110-50 140-20l4 34c-24-22-84-22-124 8z" ${f('#f4d03f')}/>` : '<path d="M370 250c40-50 110-50 140-20"/><path d="M386 272c40-30 100-30 124-8"/>';
    const grapes = fixed ? [[392, 262], [410, 274], [390, 284], [408, 290]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" ${f('#7d3c98')}/>`).join('') : '<circle cx="430" cy="180" r="56"/>';
    const cherries = (fixed ? [140, 178, 216] : [160]).map((x) => `<circle cx="${x}" cy="392" r="16" ${f('#c0392b')}/><path d="M${x} 376c0-20 10-30 22-36" fill="none"/>`).join('');
    return `<path d="M40 410h720"/>
      <circle cx="320" cy="270" r="44" ${f('#d63031')}/><path d="M320 226c4-14 10-20 18-24" fill="none"/>
      ${fixed ? pear + grapes + banana : banana}
      <path d="M220 300h300c0 70-60 110-150 110s-150-40-150-110z" ${f('#e7d3b0')}/>
      ${fixed ? '' : pear + grapes}${cherries}`;
  };
  const FRUIT = messyPair(fruit,
    '<circle cx="320" cy="270" r="46" fill="#8e44ad"/>',
    GUIDES('<ellipse cx="370" cy="300" rx="170" ry="40"/><path d="M370 150v280M180 300h380"/>') +
    SCRIBBLE('<path d="M90 120l40-20 20 30 40-30"/><path d="M560 120c20 20 50-10 70 10s40 0 50-20"/><path d="M250 460l30-20 30 20 30-20 30 20"/><path d="M700 60l-40 50M670 60l40 50"/>'));

  /* ---------- layered illustration references ---------- */
  const NIGHT = svg(`
    <rect width="800" height="500" fill="url(#nt)"/>
    <circle cx="140" cy="90" r="38" fill="#f5f1d6"/>
    <g fill="#1d2440"><rect x="380" y="150" width="120" height="270"/><rect x="510" y="200" width="100" height="220"/><rect x="620" y="120" width="140" height="300"/><rect x="250" y="230" width="110" height="190"/></g>
    <g fill="#ffd56b"><rect x="400" y="180" width="20" height="24"/><rect x="450" y="230" width="20" height="24"/><rect x="530" y="240" width="18" height="22"/><rect x="650" y="160" width="22" height="26"/><rect x="700" y="260" width="22" height="26"/><rect x="280" y="270" width="18" height="22"/></g>
    <rect y="420" width="800" height="80" fill="#2a2f45"/>
    <path d="M0 460h800" stroke="#e8e8e8" stroke-width="5" stroke-dasharray="40 30"/>
    <circle cx="170" cy="215" r="90" fill="url(#gl)"/>
    <path d="M170 420V230M170 230h30" stroke="#111" stroke-width="10"/><path d="M190 222h40l-8 22h-24z" fill="#333"/>
    <ellipse cx="210" cy="470" rx="70" ry="10" fill="#ffd56b" opacity=".35"/>`,
    '<linearGradient id="nt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1330"/><stop offset="1" stop-color="#3b3f7a"/></linearGradient><radialGradient id="gl"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>');
  const SEA = svg(`
    <rect width="800" height="500" fill="url(#sea)"/>
    <g fill="#ffffff" opacity=".12"><path d="M200 0h60L120 500H40z"/><path d="M420 0h50L380 500h-70z"/><path d="M620 0h40L640 500h-60z"/></g>
    <path d="M0 440c120-30 260 10 400-10s280-20 400 0v70H0z" fill="#e6d3a3"/>
    <g fill="none" stroke="#2e8b57" stroke-width="12" stroke-linecap="round"><path d="M90 460c-20-60 30-90 0-160s20-90 10-140"/><path d="M130 460c20-50-20-90 10-140"/><path d="M690 470c-20-60 20-100-5-170"/></g>
    <g stroke="#1f2a44" stroke-width="3"><path d="M330 220c40-40 120-40 150 0-30 40-110 40-150 0z" fill="#ff8c42"/><path d="M330 220l-40-30v60z" fill="#ff8c42"/><path d="M380 195v50M410 190v60" stroke="#fff" stroke-width="8"/><circle cx="455" cy="212" r="5" fill="#1f2a44"/>
    <path d="M520 330c26-24 76-24 96 0-20 24-70 24-96 0z" fill="#ffd23f"/><path d="M520 330l-26-18v36z" fill="#ffd23f"/><circle cx="596" cy="324" r="4" fill="#1f2a44"/></g>
    <g fill="none" stroke="#dff6ff" stroke-width="3"><circle cx="480" cy="160" r="8"/><circle cx="490" cy="130" r="6"/><circle cx="484" cy="104" r="4"/><circle cx="620" cy="290" r="6"/><circle cx="628" cy="266" r="4"/></g>`,
    '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fb6d9"/><stop offset="1" stop-color="#0b3b6b"/></linearGradient>');
  const BALLOONS = svg(`
    <rect width="800" height="500" fill="url(#bs)"/>
    <circle cx="660" cy="100" r="44" fill="#fff3b0"/>
    <g fill="#fff"><path d="M90 120c0-24 34-34 48-16 12-24 54-18 54 10 24 0 30 30 6 36H96c-22-2-26-28-6-30z"/><path d="M470 70c0-18 26-26 36-12 9-18 40-14 40 8 18 0 22 22 4 26h-76c-16-2-20-20-4-22z"/></g>
    <path d="M0 380c120-60 240-60 360-10s260 40 440-20v150H0z" fill="#8bc34a"/>
    <path d="M0 430c160-40 300-10 440 10s240-10 360-30v90H0z" fill="#5d9c3a"/>
    <g stroke="#333" stroke-width="3">
      <path d="M260 120c-55 0-80 40-80 80 0 50 50 80 70 110h20c20-30 70-60 70-110 0-40-25-80-80-80z" fill="#e74c3c"/><path d="M260 120c-20 30-24 130 0 190M260 120c20 30 24 130 0 190" fill="none"/>
      <path d="M248 310l2 22h20l2-22M250 332h20v18h-20z" fill="#8d6e63"/>
      <path d="M520 190c-40 0-58 28-58 58 0 36 36 58 50 80h16c14-22 50-44 50-80 0-30-18-58-58-58z" fill="#3498db"/><path d="M462 248h116" fill="none"/>
      <path d="M512 328h16v14h-16z" fill="#8d6e63"/>
      <path d="M380 60c-28 0-40 20-40 40 0 24 24 40 34 54h12c10-14 34-30 34-54 0-20-12-40-40-40z" fill="#f1c40f"/><path d="M374 154h12v10h-12z" fill="#8d6e63"/>
    </g>`,
    '<linearGradient id="bs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4ff"/><stop offset="1" stop-color="#e6f5ff"/></linearGradient>');

  /* ---------- task builders ---------- */
  const trace = (id, name, parts) => ({
    id, type: 'trace', estMin: 10,
    title: `Trace and color: ${name}`,
    prompt: `Trace the ${name.toLowerCase()} on the canvas, then color it to match the reference.`,
    steps: [
      'The faded drawing is on the "Trace me" layer; draw on the "Ink" layer above it',
      'Ink every outline with the Ink Pen; use Ellipse/Rectangle/Line where shapes are geometric',
      'Add a "Color" layer below Ink and bucket-fill each region (Sample: All layers)',
      'Use at least one Gradient inside a selection for depth',
      'Hide the "Trace me" layer and clean up gaps with the Eraser',
    ],
    image: icon(parts, true),
    startLayers: [{ name: 'Trace me', image: icon(parts, false), opacity: 0.35 }],
    newLayers: ['Ink'],
  });
  const scene = (id, name, image, extra) => ({
    id, type: 'scene', estMin: 15,
    title: `Scene from reference: ${name}`,
    prompt: `Paint the ${name.toLowerCase()} from the reference image: line art, flat color, then shading.`,
    steps: [
      'Sketch the composition with the Pencil on a "Sketch" layer',
      'Line art with the Ink Pen on a new layer; lower the Sketch layer opacity or hide it',
      'Flat colors on a layer under the line art (Bucket, Brush); Gradient for the sky',
      'Shading and light: Airbrush and Smudge on their own layer',
    ].concat(extra),
    image,
  });
  const messy = (id, name, pair, fixes) => ({
    id, type: 'edit', estMin: 15,
    title: `Fix the messy sketch: ${name}`,
    prompt: 'The canvas starts with a rough sketch full of mistakes. Fix everything in the list so it matches the target picture.',
    steps: fixes,
    image: pair.target,
    startLayers: [{ name: 'Rough sketch', image: pair.sketch, opacity: 1 }],
  });
  const layered = (id, name, image, layers) => ({
    id, type: 'layered', estMin: 15,
    title: `Layered illustration: ${name}`,
    prompt: `Recreate the ${name.toLowerCase()} using at least ${layers.length} separate layers.`,
    steps: [`Create and name these layers: ${layers.join(', ')}`]
      .concat([
        'Paint each part on its own layer (use the eye icon to check layers separately)',
        'Reorder layers with the arrows if something ends up behind the wrong thing',
        'Use layer opacity for at least one effect (glow, haze or reflection)',
        'Merge two detail layers at the end with Merge down',
      ]),
    image,
  });

  const S1 = [
    trace('P1-S1-trace', 'Rocket badge', ROCKET),
    scene('P1-S1-scene', 'Mountain lake at sunset', LAKE, ['Mirror the mountains in the lake: copy with Lasso, Move, then Transform (flip by dragging a corner past the middle)', 'Eyedropper colors from your sky into the water']),
    messy('P1-S1-edit', 'Coffee table', CAFE, [
      'Erase the four gray scribbles and the light construction lines',
      'Close the gap in the mug handle',
      'Recolor the red saucer blue',
      'Move the steam from the right so it rises from the mug',
      'The plant is floating: move it down onto the table',
      'Shrink the oversized spoon and put it on the table left of the saucer (Lasso + Transform)',
      'Clone the cookie so there are three',
      'Ink clean lines on a new layer, then color the mug, coffee and plant to match the target',
    ]),
    layered('P1-S1-layer', 'Night street', NIGHT, ['Sky', 'Buildings', 'Street', 'Lamp & glow']),
  ];
  const S2 = [
    trace('P1-S2-trace', 'Camera', CAMERA),
    scene('P1-S2-scene', 'Desert canyon', CANYON, ['Draw the rock layers on the mesas with the Line tool', 'Add cactus shadows on the sand with a low-opacity Brush']),
    messy('P1-S2-edit', 'House and tree', HOUSE, [
      'Erase the four gray scribbles and the light construction lines',
      'Recolor the green roof red',
      'Straighten the crooked door (erase it, redraw with the Rectangle tool)',
      'Move the tree to the right side of the house',
      'Shrink the huge sun and move it to the top-right corner',
      'Clone the cloud so there are three',
      'Add a chimney with the Rectangle tool',
      'Ink clean lines on a new layer, then color the walls, windows, door and tree',
    ]),
    layered('P1-S2-layer', 'Underwater scene', SEA, ['Water', 'Light rays', 'Seaweed & sand', 'Fish', 'Bubbles']),
  ];
  const S3 = [
    trace('P1-S3-trace', 'Light bulb', BULB),
    scene('P1-S3-scene', 'Snowy forest cabin', CABIN, ['Glow from the window: Airbrush on a layer with lowered opacity', 'Snow on the trees and roof with a white Brush, then Smudge the edges']),
    messy('P1-S3-edit', 'Fruit bowl', FRUIT, [
      'Erase the four gray scribbles and the light construction lines',
      'Recolor the purple apple red',
      'Close the banana: join its two outlines at both ends',
      'Move the pear into the bowl',
      'Shrink the giant grape, then clone it into a small bunch in the bowl',
      'Clone the cherry so there are three',
      'Color the bowl with a Gradient',
      'Ink clean lines on a new layer, then color the remaining fruit',
    ]),
    layered('P1-S3-layer', 'Hot-air balloons', BALLOONS, ['Sky', 'Clouds', 'Far hills', 'Near hills', 'Balloons']),
  ];

  MP.TASK_SETS = {
    p1s1: { label: 'Phase 1 · Session 1 (4 tasks, ~50 min)', tasks: S1 },
    p1s2: { label: 'Phase 1 · Session 2 (4 tasks, ~50 min)', tasks: S2 },
    p1s3: { label: 'Phase 1 · Session 3 (4 tasks, ~50 min)', tasks: S3 },
    p1all: { label: 'Phase 1 · All sessions in one go (12 tasks)', tasks: S1.concat(S2, S3) },
  };
  MP.PHASE1_ORDER = ['p1s1', 'p1s2', 'p1s3'];
})(window.MP);
