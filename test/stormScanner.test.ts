import { describe, expect, it } from 'vitest';
import {
    bearing,
    calcETA,
    clusterPoints,
    dbzColor,
    dbzLabel,
    degToDir,
    destPoint,
    haversine,
    isUSLocation,
    nexradToDbz,
    rvToDbz,
    type StormCell,
} from '../src/stormScanner';

/**
 * These pin down what the scanner does TODAY, before anything is reorganised.
 *
 * The project had no tests and the build only checks that it compiles, so
 * every clean-up on the review's list — deduplicating the tile loops, breaking
 * `scanForStorms` apart, moving the constants out — would otherwise be a
 * change to nine hundred lines with no way of telling whether the numbers on
 * screen still came out the same. That is the wrong order to do it in.
 *
 * Where a real answer is knowable the test asserts the real answer rather than
 * whatever the code currently prints: a degree of latitude is 69.09 miles
 * whoever wrote the haversine. Where the value is a judgement — the radar
 * palettes, the clustering — it pins the current behaviour so a refactor that
 * changes it has to say so out loud.
 */

const MIA = { lat: 25.7617, lon: -80.1918 };
const ATL = { lat: 33.7490, lon: -84.3880 };

describe('geography', () => {
    it('is zero from a point to itself, and symmetric', () => {
        expect(haversine(MIA.lat, MIA.lon, MIA.lat, MIA.lon)).toBe(0);
        expect(haversine(MIA.lat, MIA.lon, ATL.lat, ATL.lon))
            .toBeCloseTo(haversine(ATL.lat, ATL.lon, MIA.lat, MIA.lon), 9);
    });

    it('makes a degree of latitude 69.1 miles', () => {
        // The one distance anybody can check without a calculator.
        expect(haversine(30, -90, 31, -90)).toBeCloseTo(69.09, 1);
    });

    it('measures Miami to Atlanta at about 600 miles', () => {
        expect(haversine(MIA.lat, MIA.lon, ATL.lat, ATL.lon)).toBeCloseTo(605, -1);
    });

    it('bears due north as 0 and due east as 90', () => {
        expect(bearing(30, -90, 31, -90)).toBeCloseTo(0, 6);
        expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 6);
        expect(bearing(30, -90, 29, -90)).toBeCloseTo(180, 6);
        // Never negative: the caller compares it against compass headings.
        expect(bearing(0, 0, 0, -1)).toBeCloseTo(270, 6);
    });

    it('gives the GREAT-CIRCLE bearing, which is not due west along a parallel', () => {
        /*
         * Due west at latitude 30 reads 270.25, not 270, and that is correct
         * rather than sloppy: the shortest path between two points on the same
         * parallel bows toward the pole, so the heading you set off on is not
         * the heading of the parallel. Pinned because it looks like an error.
         */
        expect(bearing(30, -90, 30, -91)).toBeCloseTo(270.25, 2);
    });

    it('walks out to a point and back again', () => {
        const [lat, lon] = destPoint(MIA.lat, MIA.lon, 45, 100);
        expect(haversine(MIA.lat, MIA.lon, lat, lon)).toBeCloseTo(100, 3);
        expect(bearing(MIA.lat, MIA.lon, lat, lon)).toBeCloseTo(45, 3);
    });

    it('names the sixteen compass points, and wraps', () => {
        expect(degToDir(0)).toBe('N');
        expect(degToDir(90)).toBe('E');
        expect(degToDir(180)).toBe('S');
        expect(degToDir(270)).toBe('W');
        expect(degToDir(360)).toBe('N');
        expect(degToDir(22.5)).toBe('NNE');
        // Rounds to the nearest point rather than truncating.
        expect(degToDir(11)).toBe('N');
        expect(degToDir(12)).toBe('NNE');
    });

    it('knows the lower forty-eight from everywhere else', () => {
        expect(isUSLocation(MIA.lat, MIA.lon)).toBe(true);
        expect(isUSLocation(ATL.lat, ATL.lon)).toBe(true);
        expect(isUSLocation(51.5, -0.12)).toBe(false);   // London
        expect(isUSLocation(61.2, -149.9)).toBe(false);  // Anchorage
        expect(isUSLocation(21.3, -157.8)).toBe(false);  // Honolulu
    });
});

describe('radar palettes', () => {
    it('reads a transparent pixel as no echo at all', () => {
        expect(rvToDbz(255, 0, 255, 0)).toBe(0);
        expect(rvToDbz(255, 0, 255, 29)).toBe(0);
        expect(nexradToDbz(255, 0, 255, 0)).toBe(0);
    });

    it('reads the top of each palette', () => {
        // Magenta is the strongest echo either palette draws.
        expect(rvToDbz(255, 0, 255, 255)).toBe(65);
        expect(nexradToDbz(255, 0, 255, 255)).toBe(70);
    });

    it('climbs with intensity through the middle of the RainViewer ramp', () => {
        expect(rvToDbz(255, 0, 0, 255)).toBe(55);      // red
        expect(rvToDbz(255, 255, 0, 255)).toBe(45);    // yellow — see below
        expect(rvToDbz(0, 255, 0, 255)).toBe(33);      // green
        expect(rvToDbz(0, 255, 255, 255)).toBe(28);    // cyan
    });

    it('climbs with intensity through the middle of the NEXRAD ramp', () => {
        expect(nexradToDbz(255, 255, 255, 255)).toBe(60);
        expect(nexradToDbz(255, 0, 0, 255)).toBe(55);
        expect(nexradToDbz(255, 255, 0, 255)).toBe(45);
        expect(nexradToDbz(0, 255, 0, 255)).toBe(35);
    });

    it('HAS A DEAD 40 dBZ BRANCH in both palettes', () => {
        /*
         * A real bug, and the reason to pin a palette rather than read it.
         *
         * Both ladders test a wider condition before a narrower one that it
         * completely contains:
         *
         *   rvToDbz      r>=200 && g>=120 && b<40  -> 45
         *                r>=200 && g>=200 && b<40  -> 40   <- unreachable
         *   nexradToDbz  r>=200 && g>=100 && b<40  -> 45
         *                r>=200 && g>=200 && b<40  -> 40   <- unreachable
         *
         * Anything that satisfies the second line already satisfied the first,
         * so the 40 dBZ classification never fires and yellow radar returns —
         * the ordinary heavy-rain band — are reported as 45. That is not
         * cosmetic: dBZ feeds the colour, the wording AND the impact score in
         * `calcETA`, so every yellow cell is being called one band worse than
         * it is.
         *
         * The claim is about the BRANCH, not the number: 40 still comes out of
         * the catch-all at the bottom of each ladder for mid-brightness
         * colours. It is the explicit yellow classification that never runs.
         *
         * Left as it stands, because moving a radar calibration is the owner's
         * call, not a tidy-up. Swapping the two lines in each ladder is the
         * whole fix.
         */
        for (let r = 200; r <= 255; r += 5) {
            for (let g = 200; g <= 255; g += 5) {
                for (let b = 0; b < 40; b += 5) {
                    // Every colour the `return 40` line was written for.
                    expect(rvToDbz(r, g, b, 255)).toBe(45);
                    expect(nexradToDbz(r, g, b, 255)).toBe(45);
                }
            }
        }
    });

    it('never reports a negative or absurd reflectivity for any colour', () => {
        for (let r = 0; r <= 255; r += 51) {
            for (let g = 0; g <= 255; g += 51) {
                for (let b = 0; b <= 255; b += 51) {
                    for (const f of [rvToDbz, nexradToDbz]) {
                        const dbz = f(r, g, b, 255);
                        expect(dbz).toBeGreaterThanOrEqual(0);
                        expect(dbz).toBeLessThanOrEqual(75);
                    }
                }
            }
        }
    });
});

describe('the dBZ scale on screen', () => {
    /*
     * Colour and label share their break points, and that is exactly why they
     * are worth pinning: they are two separate ladders in the source, so
     * nothing stops one being edited without the other.
     */
    const colourBreaks = [60, 55, 50, 45, 40, 35, 30, 25];
    const labelBreaks = [60, 50, 45, 40, 35, 30, 25];

    it('changes colour at each of its eight thresholds', () => {
        for (const b of colourBreaks) expect(dbzColor(b)).not.toBe(dbzColor(b - 1));
    });

    it('changes wording at each of its seven thresholds', () => {
        for (const b of labelBreaks) expect(dbzLabel(b)).not.toBe(dbzLabel(b - 1));
    });

    it('DOES NOT agree with itself at 55 dBZ', () => {
        /*
         * A real inconsistency in the shipped plugin, found by pinning the two
         * ladders against each other rather than by reading them.
         *
         * `dbzColor` breaks at 55 and `dbzLabel` does not, so a 55 dBZ cell is
         * drawn in its own colour while being called the same thing as a 50.
         * This is precisely the drift that having the same thresholds written
         * out twice invites, and it has already happened. Recorded rather than
         * quietly fixed, because whether 55 deserves its own word is a call
         * for the person who owns the scale.
         */
        expect(dbzColor(55)).not.toBe(dbzColor(54));
        expect(dbzLabel(55)).toBe(dbzLabel(54));
        expect(dbzLabel(55)).toBe('Intense');
    });

    it('names the ends of the scale', () => {
        expect(dbzLabel(70)).toBe('EXTREME');
        expect(dbzColor(70)).toBe('#ff00ff');
        expect(dbzLabel(0)).toBe('Trace');
        expect(dbzColor(0)).toBe('#00ccff');
    });

    it('gives every reflectivity a colour and a word', () => {
        for (let d = 0; d <= 80; d++) {
            expect(dbzColor(d)).toMatch(/^#[0-9a-f]{6}$/);
            expect(dbzLabel(d).length).toBeGreaterThan(0);
        }
    });
});

describe('clustering pixels into cells', () => {
    const near = { lat: 30, lng: -90 };

    it('finds nothing in nothing', () => {
        expect(clusterPoints([], 0.15, near.lat, near.lng)).toEqual([]);
    });

    it('throws away a lone pixel, because one pixel is not a storm', () => {
        const one = [{ lat: 30.1, lng: -90.1, dbz: 40, dist: 8 }];
        expect(clusterPoints(one, 0.15, near.lat, near.lng)).toEqual([]);
    });

    it('averages a cell\'s position and keeps its STRONGEST echo', () => {
        const pts = [
            { lat: 30.10, lng: -90.10, dbz: 30, dist: 0 },
            { lat: 30.12, lng: -90.12, dbz: 55, dist: 0 },
        ];
        const [cell] = clusterPoints(pts, 0.15, near.lat, near.lng);
        expect(cell.lat).toBeCloseTo(30.11, 6);
        expect(cell.lng).toBeCloseTo(-90.11, 6);
        // Peak, not mean: a storm is as severe as its worst part.
        expect(cell.dbz).toBe(55);
    });

    it('sorts cells by how close they are', () => {
        const pts = [
            { lat: 31.0, lng: -90.0, dbz: 40, dist: 0 }, { lat: 31.01, lng: -90.0, dbz: 40, dist: 0 },
            { lat: 30.2, lng: -90.0, dbz: 40, dist: 0 }, { lat: 30.21, lng: -90.0, dbz: 40, dist: 0 },
        ];
        const cells = clusterPoints(pts, 0.15, near.lat, near.lng);
        expect(cells).toHaveLength(2);
        expect(cells[0].dist).toBeLessThan(cells[1].dist);
    });

    it('measures each cell from the viewer, not from the pixels', () => {
        const pts = [
            { lat: 31, lng: -90, dbz: 40, dist: 999 },
            { lat: 31, lng: -90, dbz: 40, dist: 999 },
        ];
        const [cell] = clusterPoints(pts, 0.15, near.lat, near.lng);
        expect(cell.dist).toBeCloseTo(haversine(30, -90, 31, -90), 6);
        expect(cell.bearing).toBeCloseTo(0, 3);
    });
});

describe('time to impact', () => {
    const cell = (over: Partial<StormCell> = {}): StormCell => ({
        lat: 31, lng: -90, dbz: 45, dist: 30, bearing: 0, eta: null, track: null, ...over,
    });

    it('says nothing without wind to steer by', () => {
        expect(calcETA(cell(), null, 30, -90)).toBeNull();
        expect(calcETA(cell(), { direction: 180, speed: 1 }, 30, -90)).toBeNull();
    });

    it('gives an ETA for a storm bearing down on you', () => {
        // Due north of you, moving south — straight at you.
        const eta = calcETA(cell({ dist: 30, bearing: 0 }), { direction: 180, speed: 30 }, 30, -90);
        expect(eta).not.toBeNull();
        expect(eta!.approaching).toBe(true);
        expect(eta!.minutes).toBeCloseTo(60, 0);
        expect(eta!.impact).toBeGreaterThan(0);
    });

    it('stays silent about a storm moving away', () => {
        // North of you and heading further north.
        expect(calcETA(cell({ bearing: 0 }), { direction: 0, speed: 30 }, 30, -90)).toBeNull();
    });

    it('reports a storm already on top of you even when it is not closing', () => {
        const eta = calcETA(cell({ dist: 1, bearing: 0 }), { direction: 0, speed: 30 }, 30, -90);
        expect(eta).not.toBeNull();
        expect(eta!.approaching).toBe(false);
        expect(eta!.minutes).toBe(0);
    });

    it('keeps impact and minutes inside their bounds', () => {
        for (const dist of [0.5, 5, 30, 79]) {
            for (const speed of [3, 25, 90]) {
                const eta = calcETA(cell({ dist }), { direction: 180, speed }, 30, -90);
                if (!eta) continue;
                expect(eta.minutes).toBeGreaterThanOrEqual(0);
                expect(eta.impact).toBeGreaterThanOrEqual(0);
                expect(eta.impact).toBeLessThanOrEqual(95);
            }
        }
    });
});
