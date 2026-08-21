<!-- v1.5.2: REQUIRED for mobileUI 'small' — Windy's mobile bottom sheet
     renders this div as the collapsed grab-handle; tapping it expands the
     sheet to plugin__content. Without it the sheet has no collapsed state at
     all and the plugin appears as "nothing but the ring" on phones (matches
     Windy's official example 04-aircraft-range). -->
<div class="plugin__mobile-header">
    ⛈️ { title }
</div>
<section class="plugin__content stormtracker-plugin" class:minimized>
    <div class="st-header">
        <span class="st-icon">⛈️</span>
        <span class="st-title">{title}</span>
        <span class="st-header-spacer"></span>
        <button class="st-minimize-btn" on:click={toggleMinimize}>{minimized ? '▲' : '▼'}</button>
    </div>

    {#if !minimized}
        <div class="st-controls">
            <label class="st-label">Display Mode</label>
            <div class="st-toggle-group">
                <button class="st-btn" class:active={displayMode === 'off'} on:click={() => setMode('off')}>Off</button>
                <button class="st-btn" class:active={displayMode === 'inbound'} on:click={() => setMode('inbound')}>12 Inbound</button>
                <button class="st-btn" class:active={displayMode === 'all'} on:click={() => setMode('all')}>All</button>
            </div>
        </div>

        <div class="st-controls">
            <label class="st-label">Scan Radius</label>
            <div class="st-toggle-group">
                <button class="st-btn" class:active={scanRadius === 40} on:click={() => setRadius(40)}>40 mi</button>
                <button class="st-btn" class:active={scanRadius === 80} on:click={() => setRadius(80)}>80 mi</button>
                <button class="st-btn" class:active={scanRadius === 120} on:click={() => setRadius(120)}>120 mi</button>
            </div>
        </div>

        <div class="st-controls">
            <label class="st-label">Scan Center</label>
            <div class="st-toggle-group">
                <button class="st-btn" class:active={centerMode === 'gps'} on:click={() => setCenterMode('gps')}>📍 My location</button>
                <button class="st-btn" class:active={centerMode === 'map'} on:click={() => setCenterMode('map')}>🗺️ Map center</button>
            </div>
            {#if centerNote}
                <div class="st-center-note">{centerNote}</div>
            {/if}
        </div>

        <div class="st-controls">
            <label class="st-label">Layers</label>
            <div class="st-checks">
                <label class="st-check"><input type="checkbox" bind:checked={showPoints} on:change={replot} /> Storm Points</label>
                <label class="st-check"><input type="checkbox" bind:checked={showArrows} on:change={replot} /> Movement Arrows</label>
                <label class="st-check"><input type="checkbox" bind:checked={showTracks} on:change={replot} /> Track Cones</label>
                <label class="st-check"><input type="checkbox" bind:checked={showLightning} on:change={replot} /> ⚡ Lightning (GOES satellite)</label>
            </div>
        </div>

        <div class="st-actions">
            <button class="st-scan-btn" on:click={doScan} disabled={scanning}>
                {#if scanning}
                    <span class="st-spinner"></span> Scanning...
                {:else}
                    🔍 Scan Now
                {/if}
            </button>
            {#if autoScan}
                <button class="st-scan-btn st-stop" on:click={stopAuto}>⏹ Stop Auto</button>
            {:else}
                <button class="st-scan-btn st-auto" on:click={startAuto}>▶ Auto (2 min)</button>
            {/if}
        </div>
    {/if}

    {#if scanSource}
        <div class="st-source">{scanSource} · {storms.length} cell{storms.length !== 1 ? 's' : ''}{windData ? ` · Wind ${windData.speed} mph ${degToDir(windData.direction)}` : ''}{showLightning && lightning && lightning.strikes.length ? ` · ⚡ ${lightning.strikes.length} strike${lightning.strikes.length !== 1 ? 's' : ''}` : ''}</div>
    {/if}

    {#if !minimized}
        {#if storms.length > 0}
            <div class="st-list">
                {#each visibleStorms as storm, i}
                    <div class="st-storm" on:click={() => panToStorm(storm)}>
                        <div class="st-storm-hdr">
                            <span class="st-dbz" style="background:{dbzColor(storm.dbz)};color:{storm.dbz >= 40 ? '#000' : '#fff'}">{storm.dbz} dBZ</span>
                            <span class="st-dist">{storm.dist.toFixed(1)} mi {degToDir(storm.bearing)}</span>
                            {#if storm.eta && storm.eta.approaching}
                                <span class="st-eta">⏱ {storm.eta.minutes} min</span>
                            {/if}
                        </div>
                        <div class="st-storm-sub">
                            {dbzLabel(storm.dbz)}
                            {#if storm.track}
                                · {storm.track.speed} mph {degToDir(storm.track.dir)}
                            {:else if windData}
                                · ~{windData.speed} mph {degToDir(windData.direction)}
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {:else if scanSource}
            <div class="st-empty">No storm cells detected</div>
        {/if}

        <div class="st-footer">
            <a href="https://github.com/CAPFlyingFun/StormTracker" target="_blank">StormTracker</a> · Radar: RainViewer + NEXRAD{#if showLightning && lightning && lightning.strikes.length} · ⚡ Lightning: NOAA GOES GLM{lightning.sat ? ` (${lightning.sat})` : ''}{/if}
        </div>
    {/if}
</section>

<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import type { LatLon } from '@windy/interfaces';
    import { map } from '@windy/map';
    import bcast from '@windy/broadcast';
    import { getMyLatestPos } from '@windy/geolocation';
    import { scanForStorms, dbzColor, dbzLabel, degToDir, destPoint, haversine } from './stormScanner';
    import type { StormCell, WindData } from './stormScanner';
    import { fetchLightning, clusterStrikes } from './lightning';
    import type { LightningResult } from './lightning';
    import config from './pluginConfig';

    const { title } = config;

    let displayMode: 'off' | 'inbound' | 'all' = 'inbound';
    let scanRadius = 80;
    let showPoints = true;
    let showArrows = true;
    let showTracks = true;
    let showLightning = true;
    let lightning: LightningResult | null = null;
    let scanning = false;
    let autoScan = true;
    let autoTimer: any = null;
    let storms: StormCell[] = [];
    let scanSource = '';
    let windData: WindData | null = null;
    let mounted = false;
    let minimized = false;
    // v1.5.0: scan center follows the USER by default, not wherever the map
    // happens to be panned — the #1 field complaint was the range circle
    // sitting hundreds of miles away. 'gps' = device location (falls back to
    // map center if denied/unavailable); 'map' = old behavior. Persisted.
    let centerMode: 'gps' | 'map' =
        ((): 'gps' | 'map' => { try { return (localStorage.getItem('st-wp-centerMode') as any) === 'map' ? 'map' : 'gps'; } catch { return 'gps'; } })();
    let gpsFix: { lat: number; lng: number; ts: number } | null = null;
    let lastCenter: { lat: number; lng: number } | null = null;
    let centerNote = '';

    let pointMarkers: any[] = [];
    let arrowLines: any[] = [];
    let trackPolys: any[] = [];
    let ltgMarkers: any[] = [];
    let rangeCircle: any = null;

    $: visibleStorms = getVisibleStorms(storms, displayMode);

    function getVisibleStorms(stormList: StormCell[], mode: string): StormCell[] {
        if (mode === 'off') return [];
        if (mode === 'inbound') {
            return stormList.filter(s => s.eta && s.eta.approaching).slice(0, 12);
        }
        return stormList;
    }

    function toggleMinimize() {
        minimized = !minimized;
        updateRangeCircle();
    }

    function setMode(m: 'off' | 'inbound' | 'all') {
        displayMode = m;
        replot();
    }

    function setRadius(r: number) {
        scanRadius = r;
        updateRangeCircle();
    }

    function getVisibleMapCenter(): { lat: number; lng: number } {
        const center = map.getCenter();
        if (minimized) return { lat: center.lat, lng: center.lng };
        const isMobileFullscreen = config.mobileUI === 'fullscreen' && window.innerWidth < 768;
        if (!isMobileFullscreen) return { lat: center.lat, lng: center.lng };
        try {
            const size = map.getSize();
            if (size && size.y > 0) {
                const panelFraction = 0.45;
                const visibleH = size.y * (1 - panelFraction);
                const visibleCenterY = visibleH / 2;
                const pt = map.containerPointToLatLng([size.x / 2, visibleCenterY]);
                if (pt && pt.lat != null && pt.lng != null) {
                    return { lat: pt.lat, lng: pt.lng };
                }
            }
        } catch {}
        return { lat: center.lat, lng: center.lng };
    }

    export const onopen = (params: LatLon) => {
        if (params && params.lat != null && params.lon != null) {
            map.setView([params.lat, params.lon], Math.max(map.getZoom(), 7));
        }
        if (!mounted) return;
        doScan();
    };

    // v1.5.1: while the plugin runs, its small mobile pane can be swiped away
    // leaving only our map layers (ring/storms) with no way back in. This
    // on-map ⛈️ button re-opens the pane via rqstOpen. It lives exactly as
    // long as the plugin does — when the plugin truly closes, layers and
    // button go away together.
    let reopenCtl: any = null;
    function addReopenButton() {
        try {
            const Ctl = (L as any).Control.extend({
                onAdd() {
                    const btn = L.DomUtil.create('div', 'st-reopen-btn');
                    btn.innerHTML = '⛈️';
                    btn.title = 'StormTracker panel';
                    btn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(18,22,30,0.92);border:1px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
                    L.DomEvent.disableClickPropagation(btn);
                    L.DomEvent.on(btn, 'click', () => { try { bcast.emit('rqstOpen', config.name as any); } catch {} });
                    return btn;
                },
            });
            reopenCtl = new Ctl({ position: 'topright' });
            reopenCtl.addTo(map);
        } catch {}
    }

    onMount(() => {
        mounted = true;
        addReopenButton();
        startAuto();
    });

    onDestroy(() => {
        mounted = false;
        clearLayers();
        if (rangeCircle) { map.removeLayer(rangeCircle); rangeCircle = null; }
        if (reopenCtl) { try { map.removeControl(reopenCtl); } catch {} reopenCtl = null; }
        stopAuto();
    });

    function clearLayers() {
        pointMarkers.forEach(m => { try { map.removeLayer(m); } catch {} });
        pointMarkers = [];
        arrowLines.forEach(l => { try { map.removeLayer(l); } catch {} });
        arrowLines = [];
        trackPolys.forEach(p => { try { map.removeLayer(p); } catch {} });
        trackPolys = [];
        ltgMarkers.forEach(m => { try { map.removeLayer(m); } catch {} });
        ltgMarkers = [];
    }

    // Device GPS with an 8s timeout; caches the fix for 5 min so auto scans
    // don't hammer the sensor. Resolves null on denial/timeout — callers fall
    // back to the map center and say so in the status line.
    function getGpsFix(): Promise<{ lat: number; lng: number } | null> {
        if (gpsFix && Date.now() - gpsFix.ts < 300000) return Promise.resolve(gpsFix);
        if (!('geolocation' in navigator)) return Promise.resolve(null);
        return new Promise(resolve => {
            let settled = false;
            const done = (v: { lat: number; lng: number } | null) => { if (!settled) { settled = true; resolve(v); } };
            try {
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        gpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
                        done(gpsFix);
                    },
                    () => done(null),
                    { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
                );
                setTimeout(() => done(null), 9000);
            } catch { done(null); }
        });
    }

    async function resolveScanCenter(): Promise<{ lat: number; lng: number }> {
        if (centerMode === 'gps') {
            const fix = await getGpsFix();
            if (fix) { centerNote = ''; return { lat: fix.lat, lng: fix.lng }; }
            // v1.5.2: Windy keeps its own last-known position (GPS or IP) —
            // instant, no permission prompt. Better fallback than map center.
            try {
                const wpos = getMyLatestPos();
                if (wpos && wpos.lat != null && wpos.lon != null && wpos.source !== 'fallback') {
                    centerNote = wpos.source === 'ip' ? '📍 Approximate (IP) location' : '';
                    return { lat: wpos.lat, lng: wpos.lon };
                }
            } catch {}
            centerNote = '📍 Location unavailable — scanning map center';
        } else {
            centerNote = '';
        }
        return getVisibleMapCenter();
    }

    function setCenterMode(m: 'gps' | 'map') {
        centerMode = m;
        try { localStorage.setItem('st-wp-centerMode', m); } catch {}
        if (m === 'gps') gpsFix = null; // force a fresh fix on the tap
        doScan(true);
    }

    function updateRangeCircle() {
        const vc = lastCenter || getVisibleMapCenter();
        if (rangeCircle) { map.removeLayer(rangeCircle); rangeCircle = null; }
        rangeCircle = L.circle([vc.lat, vc.lng], {
            radius: scanRadius * 1609.34,
            color: '#3b82f6',
            fill: false,
            weight: 1,
            dashArray: '6 4',
            interactive: false
        }).addTo(map);
    }

    async function doScan(recenter = false) {
        if (scanning) return;
        scanning = true;
        const vc = await resolveScanCenter();
        // Recenter the map when the scan center just jumped (fresh GPS fix or
        // an explicit 📍 tap) so the circle and your storms are on screen —
        // but never yank the map on routine auto scans.
        const firstCenter = !lastCenter;
        lastCenter = vc;
        if ((recenter || firstCenter) && centerMode === 'gps' && !centerNote) {
            try { map.setView([vc.lat, vc.lng], Math.max(map.getZoom(), 7)); } catch {}
        }
        updateRangeCircle();
        try {
            // Radar scan and the (keyless, quota-free) GLM lightning fetch run
            // in parallel; a lightning failure never fails the scan — the
            // layer just stays empty.
            const [result, ltg] = await Promise.all([
                scanForStorms(vc.lat, vc.lng, scanRadius),
                showLightning ? fetchLightning(vc.lat, vc.lng, scanRadius).catch(() => null) : Promise.resolve(null),
            ]);
            storms = result.storms;
            scanSource = result.source;
            windData = result.wind;
            lightning = ltg;
            setTimeout(() => replot(), 0);
        } catch (e) {
            scanSource = 'Scan failed';
        }
        scanning = false;
    }

    function startAuto() {
        autoScan = true;
        doScan();
        autoTimer = setInterval(doScan, 120000);
    }

    function stopAuto() {
        autoScan = false;
        if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }

    function replot() {
        clearLayers();
        // ⚡ Observed strikes are their OWN layer — not tied to the storm
        // display mode, so real lightning still shows with storm points off.
        // Clustered ~2 mi cells with a count, age-faded, same treatment as the
        // main app's radar map. Source: NOAA GOES GLM (see footer credit).
        if (showLightning && lightning && lightning.strikes.length) {
            for (const c of clusterStrikes(lightning.strikes)) {
                const op = c.minAgeMin < 5 ? 1 : c.minAgeMin < 10 ? 0.8 : 0.5;
                const cnt = c.count > 1
                    ? `<span style="font-size:8px;font-weight:800;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;margin-left:-1px;vertical-align:super">${c.count > 99 ? '99+' : c.count}</span>`
                    : '';
                const icon = L.divIcon({
                    className: 'st-ltg-bolt',
                    html: `<div style="opacity:${op};font-size:15px;line-height:1;text-shadow:0 0 3px #000,0 0 4px #000;white-space:nowrap">⚡${cnt}</div>`,
                    iconSize: [22, 18],
                    iconAnchor: [8, 9],
                });
                const m = L.marker([c.lat, c.lng], { icon, interactive: false, keyboard: false });
                m.addTo(map);
                ltgMarkers.push(m);
            }
        }
        if (displayMode === 'off') return;

        const plotStorms = getVisibleStorms(storms, displayMode);
        const movementSource = windData;

        for (const s of plotStorms) {
            if (showPoints) {
                const color = dbzColor(s.dbz);
                const size = s.dbz >= 50 ? 8 : s.dbz >= 40 ? 7 : 6;
                const marker = L.circleMarker([s.lat, s.lng], {
                    radius: size,
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.8,
                    weight: 1
                });
                const etaText = s.eta && s.eta.approaching ? `<br>⏱ ETA: ${s.eta.minutes} min (${s.eta.impact}% impact)` : '';
                const trackText = s.track ? `<br>📐 ${s.track.speed} mph ${degToDir(s.track.dir)}` : (movementSource ? `<br>🌬 ~${movementSource.speed} mph ${degToDir(movementSource.direction)}` : '');
                marker.bindPopup(
                    `<div style="font-family:system-ui;min-width:160px;text-align:center">` +
                    `<div style="font-weight:700;color:${color};font-size:14px">${s.dbz} dBZ — ${dbzLabel(s.dbz)}</div>` +
                    `<div style="font-size:12px;margin-top:4px">${s.dist.toFixed(1)} mi ${degToDir(s.bearing)}</div>` +
                    `<div style="font-size:11px;color:#aaa;margin-top:2px">${trackText}${etaText}</div>` +
                    `</div>`
                );
                marker.addTo(map);
                pointMarkers.push(marker);
            }

            if (showArrows) {
                const track = s.track && s.track.speed >= 2 ? s.track : null;
                const dir = track ? track.dir : (movementSource ? movementSource.direction : null);
                const spd = track ? track.speed : (movementSource ? movementSource.speed : 0);
                if (dir !== null && spd >= 2) {
                    const arrowLen = Math.min(spd * 0.15, 12);
                    const [endLat, endLng] = destPoint(s.lat, s.lng, dir, arrowLen);
                    const color = track ? '#00e5ff' : '#3b82f6';
                    const line = L.polyline([[s.lat, s.lng], [endLat, endLng]], {
                        color: color,
                        weight: 2,
                        opacity: 0.9,
                        dashArray: track ? null : '4 3'
                    });
                    line.addTo(map);
                    arrowLines.push(line);

                    const arrowHead = destPoint(s.lat, s.lng, dir, arrowLen * 0.85);
                    const headL = destPoint(arrowHead[0], arrowHead[1], (dir - 150 + 360) % 360, arrowLen * 0.3);
                    const headR = destPoint(arrowHead[0], arrowHead[1], (dir + 150) % 360, arrowLen * 0.3);
                    const chevron = L.polyline([[headL[0], headL[1]], [endLat, endLng], [headR[0], headR[1]]], {
                        color: color,
                        weight: 2,
                        opacity: 0.9
                    });
                    chevron.addTo(map);
                    arrowLines.push(chevron);
                }
            }

            if (showTracks) {
                const track = s.track && s.track.speed >= 2 ? s.track : null;
                const dir = track ? track.dir : (movementSource ? movementSource.direction : null);
                const spd = track ? track.speed : (movementSource ? movementSource.speed : 0);
                if (dir !== null && spd >= 2) {
                    const coneLenMi = spd * 0.5;
                    const coneHalf = 12;
                    const steps = 12;
                    const conePoints: [number, number][] = [[s.lat, s.lng]];
                    for (let i = 0; i <= steps; i++) {
                        const ang = dir - coneHalf + (2 * coneHalf * i / steps);
                        const [lat, lng] = destPoint(s.lat, s.lng, ang, coneLenMi);
                        conePoints.push([lat, lng]);
                    }
                    conePoints.push([s.lat, s.lng]);
                    const color = dbzColor(s.dbz);
                    const cone = L.polygon(conePoints, {
                        color: color,
                        fillColor: color,
                        fillOpacity: 0.12,
                        weight: 1,
                        dashArray: '3 3',
                        interactive: false
                    });
                    cone.addTo(map);
                    trackPolys.push(cone);
                }
            }
        }
    }

    function panToStorm(storm: StormCell) {
        map.setView([storm.lat, storm.lng], Math.max(map.getZoom(), 8));
    }
</script>

<style>
    .stormtracker-plugin {
        color: #e0e0e0;
        font-family: system-ui, -apple-system, sans-serif;
        padding: 14px 16px;
        font-size: 16px;
        /* v1.5.1: the fullscreen pane used to supply the dark backdrop; the
           'small' mobile pane doesn't, which left light text floating
           invisibly over the map. Own our background. */
        background: rgba(18, 22, 30, 0.96);
    }
    /* v1.5.2: no max-height/scroll overrides on mobile — Windy's small-mode
       bottom sheet manages its own sizing once plugin__mobile-header exists;
       fighting it is how v1.5.1 stayed invisible. */
    .stormtracker-plugin.minimized {
        padding: 10px 16px;
    }
    .st-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
    }
    .minimized .st-header {
        margin-bottom: 6px;
    }
    .st-header-spacer { flex: 1; }
    .st-minimize-btn {
        background: none;
        border: 1px solid #555;
        color: #ccc;
        font-size: 16px;
        width: 36px;
        height: 36px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }
    .st-minimize-btn:hover { border-color: #888; color: #fff; }
    .st-icon { font-size: 26px; }
    .st-title { font-weight: 700; font-size: 20px; }
    .st-controls { margin-bottom: 14px; }
    .st-label { font-size: 13px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: block; }
    .st-toggle-group { display: flex; gap: 6px; }
    .st-btn {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid #444;
        background: #1a1a2e;
        color: #aaa;
        border-radius: 6px;
        cursor: pointer;
        font-size: 15px;
        transition: all 0.15s;
    }
    .st-btn:hover { border-color: #666; color: #fff; }
    .st-btn.active { background: #3b82f6; border-color: #3b82f6; color: #fff; }
    .st-checks { display: flex; flex-direction: column; gap: 10px; }
    .st-check { display: flex; align-items: center; gap: 10px; font-size: 16px; cursor: pointer; }
    .st-check input { accent-color: #3b82f6; width: 20px; height: 20px; }
    .st-actions { display: flex; gap: 8px; margin-bottom: 14px; }
    .st-scan-btn {
        flex: 1;
        padding: 12px 14px;
        border: none;
        border-radius: 8px;
        background: #3b82f6;
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.15s;
    }
    .st-scan-btn:hover { background: #2563eb; }
    .st-scan-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .st-scan-btn.st-auto { background: #16a34a; }
    .st-scan-btn.st-auto:hover { background: #15803d; }
    .st-scan-btn.st-stop { background: #dc2626; }
    .st-scan-btn.st-stop:hover { background: #b91c1c; }
    .st-spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .st-source { font-size: 14px; color: #888; margin-bottom: 10px; text-align: center; }
    .st-center-note { font-size: 12px; color: #f0ad4e; margin-top: 4px; }
    .minimized .st-source { margin-bottom: 0; }
    .st-list { max-height: 400px; overflow-y: auto; }
    .st-storm {
        padding: 10px 12px;
        margin-bottom: 6px;
        background: rgba(255,255,255,0.04);
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s;
    }
    .st-storm:hover { background: rgba(255,255,255,0.08); }
    .st-storm-hdr { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .st-dbz { padding: 4px 8px; border-radius: 4px; font-size: 14px; font-weight: 700; }
    .st-dist { font-size: 15px; color: #bbb; }
    .st-eta { font-size: 14px; color: #f59e0b; font-weight: 600; }
    .st-storm-sub { font-size: 14px; color: #777; margin-top: 3px; }
    .st-empty { text-align: center; color: #666; padding: 24px 0; font-size: 15px; }
    .st-footer { font-size: 13px; color: #555; text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px solid #333; }
    .st-footer a { color: #3b82f6; text-decoration: none; }
    .st-footer a:hover { text-decoration: underline; }
</style>
