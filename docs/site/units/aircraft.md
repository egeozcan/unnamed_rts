---
aside: false
pageClass: rts-wide
---

# Aircraft {#top}

Aircraft are produced and rearmed at the **Air-Force Command**. They ignore terrain and are immune to most ground weapons, but only a handful of units and the SAM Site can shoot them down. Numbers on this page are read straight from the game's `rules.json`, so they're always current.

<nav class="rts-index" aria-label="Aircraft index"><a class="rts-tile" href="#harrier"><img class="" src="/img/cameos/harrier.png" alt="harrier" loading="lazy"><b>Harrier</b><span>1400</span></a><a class="rts-tile" href="#heli"><img class="" src="/img/cameos/heli.png" alt="heli" loading="lazy"><b>Helicopter</b><span>1500</span></a></nav>

<div class="rts-note">
<b>How to read the charts.</b> <i>DPS</i> is damage per second at 60 ticks/s. The <i>damage vs armor</i> bars show the multiplier the unit's weapon gets against each armor class (×1 = full damage). Strengths and weaknesses are derived from those multipliers and from how each stat ranks among vehicles and aircraft.
</div>

<div class="rts-table-wrap"><table class="rts-table">
<thead><tr><th>Unit</th><th>Cost</th><th>HP</th><th>Speed</th><th>DPS</th><th>Range</th><th>Requires</th></tr></thead>
<tbody><tr><td><a href="#harrier">Harrier</a></td><td>1400</td><td>200</td><td>8</td><td>120</td><td>250</td><td>Air-Force Command</td></tr><tr><td><a href="#heli">Helicopter</a></td><td>1500</td><td>250</td><td>6</td><td>108</td><td>200</td><td>Tech Center</td></tr></tbody>
</table></div>

## Harrier {#harrier}

<section class="rts-card" aria-labelledby="harrier">
<div class="rts-card-top">
<p class="rts-tagline">Strike fighter.</p>
<a class="rts-back" href="#top">↑ Index</a>
</div>
<div class="rts-figs"><figure><img class="" src="/img/3d/harrier.png" alt="3D harrier" loading="lazy"><figcaption>3D view</figcaption></figure><figure><img class="flat" src="/img/2d/harrier.png" alt="2D harrier" loading="lazy"><figcaption>Classic 2D view</figcaption></figure><figure class="cameo"><img class="" src="/img/cameos/harrier.png" alt="harrier" loading="lazy"><figcaption>Build icon</figcaption></figure></div>
<div class="rts-stats"><div class="rts-stat" title="Credits"><span>Cost</span><b>1400</b></div><div class="rts-stat"><span>HP</span><b>200</b></div><div class="rts-stat"><span>Speed</span><b>8</b></div><div class="rts-stat"><span>Sight</span><b>320</b></div><div class="rts-stat" title="120 damage every 60 ticks"><span>DPS</span><b>120</b></div><div class="rts-stat"><span>Damage</span><b>120</b></div><div class="rts-stat"><span>Range</span><b>250</b></div><div class="rts-stat" title="60 ticks"><span>Reload</span><b>1s</b></div><div class="rts-stat"><span>Ammo</span><b>1</b></div><div class="rts-stat"><span>Armor</span><b>Aircraft</b></div></div>
<div class="rts-unlock"><span>Requires</span><a class="rts-chip" href="/unnamed_rts/buildings/#airforce_command"><img class="" src="/img/cameos/airforce_command.png" alt="airforce_command" loading="lazy"><span>Air-Force Command</span></a></div>
<div class="rts-panel"><h4>Damage vs armor <small>(Air-to-ground missiles, 120 base dps)</small></h4><div class="rts-bar-row"><span class="rts-bar-label">Infantry</span><span class="rts-bar"><i class="bad" style="width:4%"></i></span><span class="rts-bar-value bad">×0.1 · 12 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Light vehicles</span><span class="rts-bar"><i class="ok" style="width:40%"></i></span><span class="rts-bar-value ok">×1 · 120 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Medium vehicles</span><span class="rts-bar"><i class="good" style="width:50%"></i></span><span class="rts-bar-value good">×1.25 · 150 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Heavy vehicles</span><span class="rts-bar"><i class="good" style="width:50%"></i></span><span class="rts-bar-value good">×1.25 · 150 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Buildings</span><span class="rts-bar"><i class="good" style="width:60%"></i></span><span class="rts-bar-value good">×1.5 · 180 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Aircraft</span><span class="rts-bar"><i class="none" style="width:0%"></i></span><span class="rts-bar-value none">Cannot target</span></div></div>
<div class="rts-two">
<div class="rts-panel rts-pro"><h4>Strengths</h4><ul><li>Good against <b>medium vehicles</b> (×1.25)</li><li>Good against <b>heavy vehicles</b> (×1.25)</li><li>Excellent against <b>buildings</b> (×1.5)</li><li>Long range (250)</li><li><b>Flies</b>: ignores terrain and can only be hit by anti-air weapons</li><li>Fires while on the move</li><li>Fast (8)</li></ul></div>
<div class="rts-panel rts-con"><h4>Weaknesses</h4><ul><li>Barely scratches <b>infantry</b> (×0.1)</li><li><b>Cannot shoot aircraft</b></li><li>Only <b>1</b> shot per sortie: must return to rearm</li><li>Fragile (200 HP)</li></ul></div>
</div>
<div class="rts-two"><div class="rts-panel rts-pro"><h4>Shrugs off</h4><ul><li>Can't be hit by <b>Sniper rifle</b> <span class="rts-muted">(Sniper, Commando)</span></li><li>Can't be hit by <b>Flames</b> <span class="rts-muted">(Flamethrower, Flame Tank)</span></li><li>Can't be hit by <b>Grenades</b> <span class="rts-muted">(Grenadier)</span></li><li>Can't be hit by <b>Cannon</b> <span class="rts-muted">(Light Tank, Heavy Tank, Gun Turret)</span></li><li><b>Bullets</b> ×0.15 <span class="rts-muted">(Rifleman, Harvester, Ranger…)</span></li></ul></div></div>
<div class="rts-counters"><span>Best-value counters</span><a class="rts-chip" href="/unnamed_rts/units/infantry#rocket"><img class="" src="/img/cameos/rocket.png" alt="rocket" loading="lazy"><span>Rocket</span></a><a class="rts-chip" href="/unnamed_rts/units/aircraft#heli"><img class="" src="/img/cameos/heli.png" alt="heli" loading="lazy"><span>Helicopter</span></a><a class="rts-chip" href="/unnamed_rts/units/vehicles#stealth"><img class="" src="/img/cameos/stealth.png" alt="stealth" loading="lazy"><span>Missile Tank</span></a></div>
<p class="rts-brief"><b>Field notes:</b> One devastating anti-armor pass, then returns to Air-Force Command to reload. Vulnerable to Rocket soldiers, Riflemen, APCs and SAMs.</p>
</section>

## Helicopter {#heli}

<section class="rts-card" aria-labelledby="heli">
<div class="rts-card-top">
<p class="rts-tagline">Attack helicopter.</p>
<a class="rts-back" href="#top">↑ Index</a>
</div>
<div class="rts-figs"><figure><img class="" src="/img/3d/heli.png" alt="3D heli" loading="lazy"><figcaption>3D view</figcaption></figure><figure><img class="flat" src="/img/2d/heli.png" alt="2D heli" loading="lazy"><figcaption>Classic 2D view</figcaption></figure><figure class="cameo"><img class="" src="/img/cameos/heli.png" alt="heli" loading="lazy"><figcaption>Build icon</figcaption></figure></div>
<div class="rts-stats"><div class="rts-stat" title="Credits"><span>Cost</span><b>1500</b></div><div class="rts-stat"><span>HP</span><b>250</b></div><div class="rts-stat"><span>Speed</span><b>6</b></div><div class="rts-stat"><span>Sight</span><b>320</b></div><div class="rts-stat" title="45 damage every 25 ticks"><span>DPS</span><b>108</b></div><div class="rts-stat"><span>Damage</span><b>45</b></div><div class="rts-stat"><span>Range</span><b>200</b></div><div class="rts-stat" title="25 ticks"><span>Reload</span><b>0.4s</b></div><div class="rts-stat"><span>Armor</span><b>Aircraft</b></div></div>
<div class="rts-unlock"><span>Requires</span><a class="rts-chip" href="/unnamed_rts/buildings/#tech"><img class="" src="/img/cameos/tech.png" alt="tech" loading="lazy"><span>Tech Center</span></a></div>
<div class="rts-panel"><h4>Damage vs armor <small>(Rockets, 108 base dps)</small></h4><div class="rts-bar-row"><span class="rts-bar-label">Infantry</span><span class="rts-bar"><i class="poor" style="width:16%"></i></span><span class="rts-bar-value poor">×0.4 · 43.2 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Light vehicles</span><span class="rts-bar"><i class="poor" style="width:24%"></i></span><span class="rts-bar-value poor">×0.6 · 64.8 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Medium vehicles</span><span class="rts-bar"><i class="ok" style="width:34%"></i></span><span class="rts-bar-value ok">×0.85 · 91.8 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Heavy vehicles</span><span class="rts-bar"><i class="ok" style="width:40%"></i></span><span class="rts-bar-value ok">×1 · 108 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Buildings</span><span class="rts-bar"><i class="ok" style="width:40%"></i></span><span class="rts-bar-value ok">×1 · 108 dps</span></div><div class="rts-bar-row"><span class="rts-bar-label">Aircraft</span><span class="rts-bar"><i class="ok" style="width:40%"></i></span><span class="rts-bar-value ok">×1 · 108 dps</span></div></div>
<div class="rts-two">
<div class="rts-panel rts-pro"><h4>Strengths</h4><ul><li>Can shoot down <b>aircraft</b></li><li>Very high damage output (108 dps)</li><li><b>Flies</b>: ignores terrain and can only be hit by anti-air weapons</li><li>Fast (6)</li></ul></div>
<div class="rts-panel rts-con"><h4>Weaknesses</h4><ul><li>Weak against <b>infantry</b> (×0.4)</li><li>Weak against <b>light vehicles</b> (×0.6)</li><li>Needs a <b>Tech Center</b></li></ul></div>
</div>
<div class="rts-two"><div class="rts-panel rts-pro"><h4>Shrugs off</h4><ul><li>Can't be hit by <b>Sniper rifle</b> <span class="rts-muted">(Sniper, Commando)</span></li><li>Can't be hit by <b>Flames</b> <span class="rts-muted">(Flamethrower, Flame Tank)</span></li><li>Can't be hit by <b>Grenades</b> <span class="rts-muted">(Grenadier)</span></li><li>Can't be hit by <b>Cannon</b> <span class="rts-muted">(Light Tank, Heavy Tank, Gun Turret)</span></li><li><b>Bullets</b> ×0.15 <span class="rts-muted">(Rifleman, Harvester, Ranger…)</span></li></ul></div></div>
<div class="rts-counters"><span>Best-value counters</span><a class="rts-chip" href="/unnamed_rts/units/infantry#rocket"><img class="" src="/img/cameos/rocket.png" alt="rocket" loading="lazy"><span>Rocket</span></a><a class="rts-chip" href="/unnamed_rts/units/vehicles#stealth"><img class="" src="/img/cameos/stealth.png" alt="stealth" loading="lazy"><span>Missile Tank</span></a><a class="rts-chip" href="/unnamed_rts/units/vehicles#mlrs"><img class="" src="/img/cameos/mlrs.png" alt="mlrs" loading="lazy"><span>MLRS</span></a></div>
<p class="rts-brief"><b>Field notes:</b> Hunts tanks, siege and specialist infantry that cannot shoot up. Shot down by Rocket soldiers, Riflemen, APCs, Missile Tanks, MLRS and SAMs.</p>
</section>

