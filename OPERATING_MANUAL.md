# The Monster — Operating Manual

## Overview

The Monster is a hi-fi preamplifier controller consisting of two boards:

- **Amp controller (Pico)** — manages the audio hardware and front panel display
- **Bridge (Pico W)** — connects the amp to your Wi-Fi network and serves the web GUI

Once the bridge is on your network, any phone, tablet, or computer browser on the same Wi-Fi can open the GUI and control the preamp.

---

## Connecting to the GUI

Open a browser and navigate to the bridge's IP address, for example:

```
http://192.168.1.x
```

You can also use the hostname:

```
http://preamp.local
```

If you do not know the IP address, check your router's connected devices list for a device named **preamp**.

---

## Wi-Fi Setup (First Time)

If the bridge has no saved Wi-Fi credentials it starts in setup (access point) mode.

1. On your phone or laptop, connect to the Wi-Fi network named **preamp-bridge** (password: `preamp123`)
2. Open a browser to `http://192.168.4.1`
3. Enter your home Wi-Fi SSID and password and tap **Update & Connect**
4. Wait for the page to show **Connected** and an IP address
5. Tap the displayed IP link, then switch your device back to your home Wi-Fi
6. The setup access point switches off automatically once your device acknowledges the connection

> **Tip:** Reserve the bridge's IP address in your router (DHCP reservation) so it never changes.

---

## Front Panel Controls

The amp has two rotary encoders with pushbutton switches and one dedicated mute switch.

---

### Left Knob — Volume

| Action | Result |
|--------|--------|
| Rotate clockwise | Volume up 1 dB |
| Rotate counter-clockwise | Volume down 1 dB |
| Press | Enter **Balance mode** |

#### Balance Mode

The display shows the current balance. The left knob now adjusts balance in 0.5 dB steps left or right. The selector knob continues to change input. Balance mode exits automatically after **5 seconds** of no knob activity, or immediately on any button press.

---

### Right Knob — Input / Settings

In normal operation the selector knob changes input. Pressing it cycles through three settings modes in sequence:

```
Normal → Brightness → Volume Display → Normal → ...
```

#### Normal

The selector knob changes input. Volume knob adjusts volume. This is the default operating mode.

#### Brightness

The display shows the current brightness setting. The selector knob cycles through the options:

| Option | Effect |
|--------|--------|
| Off | Backlight off |
| Night | Auto-dim — display drops to off after ~3 seconds of no activity; any control press restores it |
| Low | Low brightness |
| Medium | Medium brightness |
| High | Full brightness |

The volume knob still adjusts volume while browsing. Press the right knob to advance to Volume Display mode.

#### Volume Display

The display shows the current format. The selector knob cycles through the options:

| Option | Display shows |
|--------|--------------|
| INT | Integer step (e.g. `Volume 42`) |
| dB | dB above minimum (e.g. `Volume 21.0 dB`) |
| Atten dB | dB below maximum (e.g. `Atten -11.0 dB`) |

Press the right knob to return to normal operation.

---

### Mute Switch

A dedicated toggle switch. Flipping it on mutes the output; flipping it off unmutes. The display shows **Mute** in the bottom-right corner when active.

---

### Front Panel Display

The display is a 4-line × 20-character LCD.

| Line | Content |
|------|---------|
| 1 | Volume level in the selected format |
| 2 | Active input name |
| 3 | Context information — balance value, brightness setting, or volume display mode (blank in normal operation) |
| 4 | Current time (left) and **Mute** indicator (right, when muted) |

If no bridge communication is received for 70 seconds, line 4 shows **No Bridge** instead of the time.

---

### Power-On Splash Screen

On power-up the display shows a splash screen for approximately 5 seconds:

```
    The Monster
Gingernut Labs 2026
MicroPython v1.27.0
  SW Version x.x.xx
```

The amp then moves to normal operation.

---

### Settings Persistence

All settings — volume, balance, input, brightness mode, and volume display format — are saved to flash memory approximately 10 seconds after any change. They are restored automatically on the next power-up.

> **Note:** As a safety measure, volume is capped at step 47 on restore regardless of the value that was saved.

---

## GUI Controls

### Volume

A horizontal slider with a range of **0 to 32 dB** in **1 dB steps**. The underlying MUSES chip operates at 0.5 dB resolution but the controls — both the GUI slider and the physical front panel — move in 1 dB increments. The current value is shown to the right of the slider in the format selected by the Volume Display button (see Actions below).

Moving the slider sends the new level to the amp immediately.

---

### Input

Four buttons showing the name of each input source. Tap any button to switch to that input. The currently active input is highlighted.

Input names can be customised — see **Edit Input Names** below.

---

### Mute

A toggle button labelled **Off** (unmuted) or **On** (muted). Tap to toggle. When muted the button is highlighted.

---

### Balance

A horizontal slider ranging from **−6** to **+6** steps. Each step is 0.5 dB per side, giving a maximum shift of 3 dB left or right. The value is shown to the right as:

| Display | Meaning |
|---------|---------|
| `0.0 dB` | Centred |
| `L +1.5 dB` | 1.5 dB toward left |
| `R +3.0 dB` | 3.0 dB toward right |

---

### Brightness

Five buttons controlling the brightness of the amp's front panel display:

| Button | Behaviour |
|--------|-----------|
| **Night** | Auto-dim mode — display drops to its lowest level after a period of inactivity |
| **Off** | Display backlight off |
| **Low** | Low brightness |
| **Medium** | Medium brightness |
| **High** | Full brightness |

The currently active setting is highlighted.

---

### Time

Shows the current local time from your browser clock, updated every 10 seconds. This is also sent to the amp so its display stays in sync. No action is required — it updates automatically.

---

## Actions

Three buttons in the Actions row:

### Volume Display

Cycles through three modes for how the volume level is shown on the slider:

| Mode | Display | Example |
|------|---------|---------|
| **INT** | Integer step number | `42` |
| **PLUS_DB** | dB above minimum | `21.0 dB` |
| **MINUS_DB** | dB below maximum | `−11.0 dB` |

The mode is stored on the amp and remembered across power cycles. Tap the button to cycle to the next mode; the button label updates to show the current mode.

---

### Refresh

Re-requests the full state (volume, input, balance, mute, brightness) and input labels from the amp. Use this if the display looks out of sync.

---

### Edit Input Names

Opens a dialog to rename the four inputs. Each name can be up to 16 characters. Tap **Save** to apply — the names are written to the amp and persist across power cycles. Tap **Cancel** or press Escape to discard changes.

---

## Status Bar

At the bottom of the panel:

| Indicator | Meaning |
|-----------|---------|
| **SW Version** | Bridge firmware version |
| **Preamp SW Version** | Amp firmware version |
| **Amp Connected** (green dot) | Bridge has two-way UART communication with the amp |
| **Amp Disconnected** (grey dot) | No recent response from the amp |
| **WiFi Connected** (green dot) | Browser has a live connection to the bridge |
| **WiFi Disconnected** (grey dot) | Browser cannot reach the bridge |

If the amp is powered off or disconnected from the bridge, **Amp Disconnected** will appear within about 20 seconds. It will return to **Amp Connected** within about 15 seconds of the amp coming back.

---

## Theme

A button in the top-right corner cycles between **Light** and **Dark** themes. The preference is saved in the browser and remembered next time.

---

## Connection Behaviour

The GUI maintains a WebSocket connection to the bridge for real-time updates. If the WebSocket drops (e.g. the phone goes to sleep, or the network hiccups) the app reconnects automatically. While disconnected it falls back to HTTP polling so controls remain usable. When the page becomes visible again it reconnects and re-syncs state immediately.

---

## Troubleshooting

**GUI shows WiFi Disconnected**
- Check that your device is on the same Wi-Fi network as the bridge
- Try navigating to the bridge IP directly
- If the bridge was just powered on, wait 10–15 seconds for it to connect

**GUI shows Amp Disconnected**
- Check the UART cable between the bridge and the amp
- Check that the amp is powered on
- The status updates within 15–20 seconds of the amp returning

**Controls do not respond**
- Tap **Refresh** to re-sync state
- Check the WiFi and Amp status indicators at the bottom

**Input names not showing correctly**
- Tap **Refresh** — labels are re-fetched from the amp

**Time on amp display is wrong**
- Open the GUI in a browser — time is sent to the amp on every connection
- It will correct itself within one minute of the GUI connecting
