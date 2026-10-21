# Phone Bat Cricket

A browser cricket batting game where your phone is the bat: no app, no extra
hardware. The computer (or TV) shows the stadium; you swing your phone like a
bat, and the batter on screen swings with you.

## Run it with your phone

You need Node.js 20 or newer, and the phone and computer on the **same Wi-Fi**.

Run these **inside this project folder** (the one with `package.json`). From a
parent folder, npm fails with `Missing script: "dev"`.

```bash
npm install
npm run dev
```

Leave that running; it prints `Local: https://localhost:5173/` when it's ready.

1. On the computer, open **https://localhost:5173**. The browser warns about the
   certificate: that's the dev server's own self-signed one, so continue.
2. Scan the QR code with the phone's camera. The phone warns about the
   certificate too:
   - iPhone: *Show Details* → *visit this website* → *Visit Website*.
   - Android: *Advanced* → *Proceed to 192.168.x.x*.
3. Tap **Start**. An iPhone asks for motion access: allow it. The phone shows
   two pictures: how to hold it, and the bat it becomes.
4. Hold the phone like a bat handle: **upright, top edge up, screen facing the
   screen you're playing on**. Take your stance and tap **Calibrate** (or press
   <kbd>C</kbd> on the computer).
5. The bowler runs in. Swing to meet the ball. Grip firmly, and keep clear of
   the TV and anything breakable.

Click **Sound** in the Controls panel (or anywhere on the page) to turn sound
on: browsers keep it off until you click.

Phones only hand motion sensors to secure (`https://`) pages, which is why the
dev server uses HTTPS.

### If the phone can't open the page

- **Windows Firewall**: the first time you run `npm run dev`, Windows asks
  whether Node.js may use the network. Allow it.
- **Wrong address**: if the computer has VPN, WSL or Hyper-V adapters, the game
  page offers a list of addresses. Pick the Wi-Fi one (usually `192.168.x.x`).
- **Guest or office Wi-Fi** often blocks devices from seeing each other. Try a
  home network or a phone hotspot.

## How to play

An innings is **2 overs (12 balls)** with **3 wickets**. The bowling machine
mixes pace, line and length: yorkers, full balls, good length and short.

- **Timing is everything.** Meet the ball on time and it's driven hard. A touch
  early and it goes up in the air: that's how you hit sixes. Late, and it's
  chopped into the ground. Miss a straight one and you're bowled.
- **Footwork is automatic.** A phone can't tell where your feet are, so the
  batter steps into line and gets to the ball's height by themselves. You only
  choose when and how to swing.
- **Where it goes:** early swings pull the ball to leg, late ones steer it to
  the off side, and the bat face does the rest.
- **Scoring:** fielders chase the ball and catch what they can reach. Runs come
  from how long the ball takes to get back; past the rope is four, over it on
  the full is six. Your best innings is remembered.

### Difficulty

| | Easy (default) | Intermediate | Hard |
|---|---|---|---|
| What counts as a hit | **Your swing's timing.** Swing in time with the ball (up to 170 ms early or 70 ms late) and you hit it, whatever the exact path of your bat. | Your bat has to meet the ball, but the bat is big and forgives a late swing; a well-timed swing that just misses still connects. | Your bat has to meet a real-size ball. |
| Power | Swing hard and it flies: sixes come from strong, slightly early swings. | Extra power and loft. | Real physics. |
| Fielders | Drop plenty. | Catch most. | Catch what they reach. |
| Bowling | Slow, mostly full and good length. | Medium. | Fast, all lengths. |

Picking a difficulty also sets its bowling pace; you can change the pace
separately afterwards.

### Controls

Everything is in the **Controls** panel (bottom right of the game page), and
each has a key. The selected option of each choice is filled in gold with a
✓, switches show **ON** or **OFF**, and a message above the panel confirms
every change.

| Control | Key | Does |
|---|---|---|
| Calibrate | <kbd>C</kbd> | Take your stance first. Turns green, and says "Calibrated ✓", when done. |
| Pause | <kbd>P</kbd> | No more balls after the current one, until you switch it off. |
| New innings | <kbd>R</kbd> | Starts again at 0/0. |
| Difficulty | <kbd>E</kbd> <kbd>I</kbd> <kbd>H</kbd> | Easy, Intermediate, Hard (from the next ball). |
| Bowling pace | <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Slow (70–85 km/h), medium (85–105) or fast (110–135). |
| Camera | <kbd>V</kbd> | Behind the batter, side-on, or from the bowler's end. |
| Sound | | Browsers keep sound off until you click; this turns it on or off. |
| Stats | <kbd>S</kbd> | The link and swing numbers (top right). |
| Debug | <kbd>D</kbd> | The arm model's line and the bat toe's trail (one dot per phone reading). |
| Hide | <kbd>M</kbd> | Tucks the panel away during play. |

## Test without a phone

```bash
npm run dev:http
```

Open **http://localhost:5173**, then open the controller link shown under the QR
code in a second tab, with `?sim` added before the `#`:
`http://localhost:5173/controller.html?sim#<code>`. The simulator lets you drag
to tilt and turn a pretend phone, and plays a scripted straight drive on
<kbd>Space</kbd>. Keep the simulator's tab visible: browsers slow background
tabs to a few readings a second.

`dev:http` skips HTTPS, so strict browsers load it without a certificate
warning. Phones get no sensors this way.

## The numbers (press S)

| Reading | What it tells you |
|---|---|
| Latency (one way) | Time from the phone reading its sensors to the game receiving it. |
| Samples | Readings per second. Phones usually manage about 60. |
| Longest gap, last 1 s | The worst pause between readings; spikes show Wi-Fi hiccups. |
| Lost / late | Readings that never arrived, or arrived after a newer one. |
| Last / best swing | Peak bat-toe speed and spin. "gyro maxed" means the phone's gyro hit its limit (about 2000°/s), so the real swing was faster. |

On the phone, **Motion from** defaults to the **phone's own orientation**,
which the operating system fuses from the raw sensors hundreds of times a
second. In real swings it proved much more accurate than our own fusion of the
~60 samples a second the browser passes on (gyro + accelerometer through
[ahrs](https://github.com/psiphi75/ahrs)'s Madgwick filter). Ours is the
fallback for browsers that report motion but not orientation.

## How it fits together

```
 Game page (index.html)                 Phone page (controller.html)
 three.js stadium, players, ball        sensors → orientation, ~60 readings/s
 physics, collision, scoring
          ▲                                          │
          └──────── ControllerLink (WebRTC) ◄────────┘
              PeerJS + webrtc-remote-control
              signaling: local PeerServer, proxied at /peerjs
```

**Hits are judged at the moment you swung.** Every phone reading carries its
own timestamp, moved onto the game's clock by ping/pong clock sync. On
Intermediate and Hard, when a reading arrives the game sweeps the bat between
it and the previous reading in 0.5 ms steps and checks it against where the
ball was at each of those instants. On Easy (and as Intermediate's fallback),
it watches for the swing's fastest moment instead, and compares that with when
the ball reached the bat. Either way network lag can't make you miss. The
whole scene is also drawn the same few milliseconds behind real time, so the
ball on screen lines up with the bat on screen.

The game (`src/game/`):

- `match.ts`: the delivery cycle and innings (run-up, release, contact,
  outcome, score).
- `bowling.ts`: picks pace, line and length and solves the release that pitches
  the ball there; also the bowler's run-up and action.
- `physics.ts`: ball flight with gravity, air drag and bounces, sampled so any
  past moment can be looked up again.
- `difficulty.ts`: what Easy, Intermediate and Hard change.
- `collision.ts`: bat–ball contact and the rebound (sweet spot, edges, bat
  speed), and the timed shots used on Easy.
- `controls.ts`: the control panel and keyboard shortcuts.
- `field.ts`: fielders, catches, ground fielding and runs.
- `bat.ts`: turns the phone's orientation into the bat, with calibration, the
  arm model, and the batter's automatic footwork.
- `batter.ts`, `puppet.ts`: the players. Each is posed by naming where the
  pelvis, chest, head, hands and feet go, with two-bone IK solving the elbows
  and knees.
- `scene.ts`, `environment.ts`, `ground.ts`, `stadium.ts`, `effects.ts`,
  `textures.ts`: the stadium, sky and lighting, mown outfield and painted pitch,
  stands with an animated crowd, floodlights, LED boards, big screen, dust,
  bails and impact flash. All drawn in code, with no image files.
- `hud.ts`, `audio.ts`: broadcast-style graphics and synthesized sounds.
- `stats.ts`: clock sync, latency, and swing detection.

The link (`src/link/`):

- `controller-link.ts`: the two interfaces the pages talk through
  (`ControllerLinkHost` for the game, `ControllerLinkClient` for the phone).
  Swapping the transport (Trystero, a WebSocket relay…) means writing another
  implementation of these, nothing else.
- `peerjs-link.ts`: the WebRTC implementation.
- `protocol.ts`: the messages sent each way.

The phone (`src/controller/`): `motion.ts` has the motion sources (the phone's
own orientation, the ahrs fallback, the desktop simulator); `sign-check.ts`
works out the sensors' sign conventions.

`scripts/peer-server.mjs` is the local signaling server. To use PeerJS's public
one instead, put `VITE_PEER_SERVER=public` in `.env.local`.

## Known limits

- **No TURN server.** Phones and the game connect directly on the same network.
  Before this goes public, networks that block direct connections (mobile data,
  strict Wi-Fi) will need one.
- **Position is a model, not a measurement.** Phones measure orientation, not
  where they are in space. The arm model's constants in `src/game/bat.ts` are a
  first guess, waiting to be tuned against real swings.
- **Right-handed batting only**, against a right-arm seamer with a fixed field.
- **No LBW, wides or no-balls yet.** The batter has no pads in the physics.
