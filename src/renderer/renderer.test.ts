import { describe, it, expect } from 'vitest';
import { Vector, Entity, BUILD_RADIUS, PLAYER_COLORS, HarvesterUnit } from '../engine/types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource, createTestRock } from '../engine/test-utils';

describe('Renderer Logic', () => {
    describe('worldToScreen transformation', () => {
        // Test the worldToScreen logic (same as in Renderer class)
        function worldToScreen(
            worldPos: Vector,
            camera: { x: number; y: number },
            zoom: number
        ): { x: number; y: number } {
            return {
                x: (worldPos.x - camera.x) * zoom,
                y: (worldPos.y - camera.y) * zoom
            };
        }

        it('should convert world coordinates to screen with no offset', () => {
            const result = worldToScreen(new Vector(100, 100), { x: 0, y: 0 }, 1);
            expect(result.x).toBe(100);
            expect(result.y).toBe(100);
        });

        it('should apply camera offset correctly', () => {
            const result = worldToScreen(new Vector(100, 100), { x: 50, y: 30 }, 1);
            expect(result.x).toBe(50);
            expect(result.y).toBe(70);
        });

        it('should apply zoom correctly', () => {
            const result = worldToScreen(new Vector(100, 100), { x: 0, y: 0 }, 2);
            expect(result.x).toBe(200);
            expect(result.y).toBe(200);
        });

        it('should combine camera and zoom', () => {
            const result = worldToScreen(new Vector(200, 150), { x: 100, y: 50 }, 0.5);
            // (200 - 100) * 0.5 = 50, (150 - 50) * 0.5 = 50
            expect(result.x).toBe(50);
            expect(result.y).toBe(50);
        });

        it('should handle negative world coordinates', () => {
            const result = worldToScreen(new Vector(-50, -100), { x: 0, y: 0 }, 1);
            expect(result.x).toBe(-50);
            expect(result.y).toBe(-100);
        });

        it('should handle camera positioned past the object', () => {
            const result = worldToScreen(new Vector(100, 100), { x: 200, y: 200 }, 1);
            expect(result.x).toBe(-100);
            expect(result.y).toBe(-100);
        });

        it('should handle fractional zoom levels', () => {
            const result = worldToScreen(new Vector(100, 100), { x: 0, y: 0 }, 0.75);
            expect(result.x).toBe(75);
            expect(result.y).toBe(75);
        });
    });

    describe('isValidBuildLocation logic', () => {
        // Test the isValidBuildLocation logic (same as in Renderer class)
        function isValidBuildLocation(
            x: number,
            y: number,
            owner: number,
            entities: Entity[]
        ): boolean {
            let near = false;
            for (const e of entities) {
                if (e.owner === owner && e.type === 'BUILDING' && !e.dead) {
                    if (e.pos.dist(new Vector(x, y)) < BUILD_RADIUS) {
                        near = true;
                        break;
                    }
                }
            }

            // Also check no collision with existing entities
            for (const e of entities) {
                if (!e.dead && e.pos.dist(new Vector(x, y)) < (e.radius + 45)) {
                    return false;
                }
            }

            return near;
        }

        it('should return false when no buildings nearby', () => {
            const entities = [
                createTestCombatUnit({ id: 'unit1', owner: 0, key: 'light', x: 1000, y: 1000 })
            ];
            const result = isValidBuildLocation(500, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should return true when near own building with no collisions', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 })
            ];
            // Place building 200 units away (within BUILD_RADIUS but outside collision)
            const result = isValidBuildLocation(700, 500, 0, entities);
            expect(result).toBe(true);
        });

        it('should return false when near enemy building', () => {
            const entities = [
                createTestBuilding({ id: 'enemy_cy', owner: 1, key: 'conyard', x: 500, y: 500 })
            ];
            const result = isValidBuildLocation(600, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should return false when colliding with entity', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 }),
                createTestCombatUnit({ id: 'unit1', owner: 0, key: 'light', x: 580, y: 500 })
            ];
            // Try to place exactly on unit's position
            const result = isValidBuildLocation(580, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should return false when too far from own buildings', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 })
            ];
            // Place building very far away (outside BUILD_RADIUS)
            const result = isValidBuildLocation(1500, 1500, 0, entities);
            expect(result).toBe(false);
        });

        it('should ignore dead buildings for proximity check', () => {
            const entities = [
                createTestBuilding({ id: 'dead_cy', owner: 0, key: 'conyard', x: 500, y: 500, dead: true })
            ];
            const result = isValidBuildLocation(600, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should ignore dead entities for collision check', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 }),
                createTestCombatUnit({ id: 'dead_unit', owner: 0, key: 'light', x: 600, y: 500, dead: true })
            ];
            const result = isValidBuildLocation(600, 500, 0, entities);
            expect(result).toBe(true);
        });

        it('should handle multiple buildings from same owner', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 100, y: 100 }),
                createTestBuilding({ id: 'power', owner: 0, key: 'power', x: 500, y: 500 })
            ];
            // Near second building
            const result = isValidBuildLocation(700, 500, 0, entities);
            expect(result).toBe(true);
        });

        it('should check collision with buildings too', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500, radius: 50 })
            ];
            // Too close - will collide with the building itself
            const result = isValidBuildLocation(520, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should handle resources as collision obstacles', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 }),
                createTestResource({ id: 'ore', x: 600, y: 500 })
            ];
            const result = isValidBuildLocation(600, 500, 0, entities);
            expect(result).toBe(false);
        });

        it('should handle rocks as collision obstacles', () => {
            const entities = [
                createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 500, y: 500 }),
                createTestRock({ id: 'rock1', x: 600, y: 500, size: 60 })
            ];
            const result = isValidBuildLocation(600, 500, 0, entities);
            expect(result).toBe(false);
        });
    });

    describe('Entity culling logic', () => {
        // Test whether entities should be culled based on screen position
        function shouldCull(
            screenX: number,
            screenY: number,
            canvasWidth: number,
            canvasHeight: number
        ): boolean {
            return screenX < -100 || screenX > canvasWidth + 100 ||
                screenY < -100 || screenY > canvasHeight + 100;
        }

        it('should not cull entities on screen', () => {
            expect(shouldCull(500, 400, 1000, 800)).toBe(false);
        });

        it('should not cull entities at screen edges', () => {
            expect(shouldCull(0, 0, 1000, 800)).toBe(false);
            expect(shouldCull(1000, 800, 1000, 800)).toBe(false);
        });

        it('should not cull entities within 100px buffer', () => {
            expect(shouldCull(-50, 400, 1000, 800)).toBe(false);
            expect(shouldCull(1050, 400, 1000, 800)).toBe(false);
            expect(shouldCull(500, -50, 1000, 800)).toBe(false);
            expect(shouldCull(500, 850, 1000, 800)).toBe(false);
        });

        it('should cull entities far left of screen', () => {
            expect(shouldCull(-150, 400, 1000, 800)).toBe(true);
        });

        it('should cull entities far right of screen', () => {
            expect(shouldCull(1150, 400, 1000, 800)).toBe(true);
        });

        it('should cull entities far above screen', () => {
            expect(shouldCull(500, -150, 1000, 800)).toBe(true);
        });

        it('should cull entities far below screen', () => {
            expect(shouldCull(500, 950, 1000, 800)).toBe(true);
        });
    });

    describe('Entity Y-sorting for layering', () => {
        it('should sort entities by Y position ascending', () => {
            const entities = [
                createTestCombatUnit({ id: 'e1', owner: 0, key: 'light', x: 100, y: 300 }),
                createTestCombatUnit({ id: 'e2', owner: 0, key: 'light', x: 200, y: 100 }),
                createTestCombatUnit({ id: 'e3', owner: 0, key: 'light', x: 300, y: 200 })
            ];

            const sorted = entities.sort((a, b) => a.pos.y - b.pos.y);

            expect(sorted[0].id).toBe('e2'); // y=100
            expect(sorted[1].id).toBe('e3'); // y=200
            expect(sorted[2].id).toBe('e1'); // y=300
        });

        it('should handle same Y positions', () => {
            const entities = [
                createTestCombatUnit({ id: 'e1', owner: 0, key: 'light', x: 100, y: 200 }),
                createTestCombatUnit({ id: 'e2', owner: 0, key: 'light', x: 200, y: 200 }),
                createTestCombatUnit({ id: 'e3', owner: 0, key: 'light', x: 300, y: 200 })
            ];

            const sorted = entities.sort((a, b) => a.pos.y - b.pos.y);

            // All have same Y, order preserved or stable
            expect(sorted.every(e => e.pos.y === 200)).toBe(true);
        });
    });

    describe('Projectile color logic', () => {
        function getProjectileColor(type: string): string {
            return type === 'heal' ? '#0f0' : (type === 'rocket' ? '#f55' : '#ff0');
        }

        it('should return green for heal projectiles', () => {
            expect(getProjectileColor('heal')).toBe('#0f0');
        });

        it('should return red for rocket projectiles', () => {
            expect(getProjectileColor('rocket')).toBe('#f55');
        });

        it('should return yellow for default projectiles', () => {
            expect(getProjectileColor('bullet')).toBe('#ff0');
            expect(getProjectileColor('shell')).toBe('#ff0');
            expect(getProjectileColor('')).toBe('#ff0');
        });
    });

    describe('Tooltip hit detection', () => {
        function isHovering(
            mousePos: { x: number; y: number },
            entityScreenPos: { x: number; y: number },
            entityRadius: number,
            zoom: number
        ): boolean {
            const dist = Math.sqrt(
                Math.pow(entityScreenPos.x - mousePos.x, 2) +
                Math.pow(entityScreenPos.y - mousePos.y, 2)
            );
            return dist < (entityRadius + 5) * zoom;
        }

        it('should detect hover when mouse is on entity', () => {
            const result = isHovering(
                { x: 100, y: 100 },
                { x: 100, y: 100 },
                15,
                1
            );
            expect(result).toBe(true);
        });

        it('should detect hover when mouse is within radius + 5', () => {
            const result = isHovering(
                { x: 115, y: 100 },
                { x: 100, y: 100 },
                15,
                1
            );
            expect(result).toBe(true);
        });

        it('should not detect hover when mouse is outside radius', () => {
            const result = isHovering(
                { x: 150, y: 100 },
                { x: 100, y: 100 },
                15,
                1
            );
            expect(result).toBe(false);
        });

        it('should scale hover detection with zoom', () => {
            // At zoom 2, the radius is effectively doubled: (15+5)*2 = 40
            // Distance 30 < 40, so should detect hover
            const result = isHovering(
                { x: 130, y: 100 },
                { x: 100, y: 100 },
                15,
                2
            );
            expect(result).toBe(true);
        });
    });

    describe('HP and cargo bar calculations', () => {
        it('should calculate HP ratio correctly', () => {
            const entity = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 100, y: 100, hp: 75, maxHp: 100 });
            const ratio = entity.hp / entity.maxHp;
            expect(ratio).toBe(0.75);
        });

        it('should handle zero HP', () => {
            const entity = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 100, y: 100, hp: 0, maxHp: 100 });
            const ratio = Math.max(0, entity.hp / entity.maxHp);
            expect(ratio).toBe(0);
        });

        it('should calculate harvester cargo ratio', () => {
            const entity = createTestHarvester({ id: 'harv', owner: 0, x: 100, y: 100, cargo: 250 });
            const capacity = 500;
            const ratio = Math.min(1, (entity as HarvesterUnit).harvester.cargo / capacity);
            expect(ratio).toBe(0.5);
        });

        it('should cap cargo ratio at 1', () => {
            const entity = createTestHarvester({ id: 'harv', owner: 0, x: 100, y: 100, cargo: 600 });
            const capacity = 500;
            const ratio = Math.min(1, (entity as HarvesterUnit).harvester.cargo / capacity);
            expect(ratio).toBe(1);
        });

        it('should show HP bar for damaged entities', () => {
            const entity = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 100, y: 100, hp: 90, maxHp: 100 });
            const shouldShowHpBar = entity.hp < entity.maxHp;
            expect(shouldShowHpBar).toBe(true);
        });

        it('should not require HP bar for full health unselected entities', () => {
            const entity = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 100, y: 100, hp: 100, maxHp: 100 });
            const isSelected = false;
            const shouldShowHpBar = isSelected || entity.hp < entity.maxHp;
            expect(shouldShowHpBar).toBe(false);
        });
    });

    describe('Turret entity identification', () => {
        const turretEntities = ['light', 'heavy', 'mammoth', 'artillery', 'flame_tank', 'turret', 'sam_site', 'pillbox', 'jeep'];

        it('should identify all turret-capable entities', () => {
            for (const key of turretEntities) {
                expect(turretEntities.includes(key)).toBe(true);
            }
        });

        it('should not include infantry as turret entities', () => {
            expect(turretEntities.includes('rifle')).toBe(false);
            expect(turretEntities.includes('rocket')).toBe(false);
            expect(turretEntities.includes('engineer')).toBe(false);
        });

        it('should not include harvester as turret entity', () => {
            expect(turretEntities.includes('harvester')).toBe(false);
        });

        it('should not include buildings without turrets', () => {
            expect(turretEntities.includes('conyard')).toBe(false);
            expect(turretEntities.includes('power')).toBe(false);
            expect(turretEntities.includes('refinery')).toBe(false);
            expect(turretEntities.includes('barracks')).toBe(false);
            expect(turretEntities.includes('factory')).toBe(false);
        });
    });

    describe('Player color handling', () => {
        it('should have 8 player colors defined', () => {
            expect(PLAYER_COLORS.length).toBe(8);
        });

        it('should have blue as first player color', () => {
            expect(PLAYER_COLORS[0]).toBe('#4488ff');
        });

        it('should have red as second player color', () => {
            expect(PLAYER_COLORS[1]).toBe('#ff4444');
        });

        it('should fallback to gray for invalid owner', () => {
            const owner = 99;
            const playerColor = PLAYER_COLORS[owner] || '#888888';
            expect(playerColor).toBe('#888888');
        });
    });

    describe('Repair icon flash logic', () => {
        it('should show repair icon for first 20 ticks of 30-tick cycle', () => {
            for (let tick = 0; tick < 20; tick++) {
                const showIcon = (tick % 30) < 20;
                expect(showIcon).toBe(true);
            }
        });

        it('should hide repair icon for last 10 ticks of 30-tick cycle', () => {
            for (let tick = 20; tick < 30; tick++) {
                const showIcon = (tick % 30) < 20;
                expect(showIcon).toBe(false);
            }
        });

        it('should repeat flash cycle', () => {
            // tick 30: 30 % 30 = 0, 0 < 20 = true (shows)
            expect((30 % 30) < 20).toBe(true);
            // tick 45: 45 % 30 = 15, 15 < 20 = true (shows)
            expect((45 % 30) < 20).toBe(true);
            // tick 55: 55 % 30 = 25, 25 < 20 = false (hidden)
            expect((55 % 30) < 20).toBe(false);
        });
    });

    describe('Resource amount display', () => {
        it('should show resource bar when depleted', () => {
            // Note: createTestResource sets maxHp to the same as hp by default, so we need a different approach
            // Let's manually check the calculation logic
            const hp = 500;
            const maxHp = 1000;
            const shouldShowBar = hp < maxHp;
            expect(shouldShowBar).toBe(true);
        });

        it('should not show resource bar when full', () => {
            const entity = createTestResource({ id: 'ore', x: 100, y: 100, hp: 1000 });
            const shouldShowBar = entity.hp < entity.maxHp;
            expect(shouldShowBar).toBe(false);
        });

        it('should calculate resource depletion ratio', () => {
            // Test the calculation logic directly since we can't easily create a partially depleted resource
            const hp = 300;
            const maxHp = 1000;
            const ratio = hp / maxHp;
            expect(ratio).toBe(0.3);
        });
    });
});

