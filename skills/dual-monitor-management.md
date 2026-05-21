# Dual Monitor Management

This skill provides a standardized workflow for navigating and capturing the user's dual 4K monitor setup (7680x2160).

## Geometry
- **Monitor 1 (Primary):** X: 0 to 3840, Y: 0 to 2160
- **Monitor 2 (Secondary):** X: 3840 to 7680, Y: 0 to 2160
- **Total Canvas:** 7680 x 2160

## Standard Operations

### 1. Visual Verification (Screenshot)
To see both monitors at once, use a wide screenshot:
`computer(action='screenshot', region=[0, 0, 7680, 2160])`

To focus on Monitor 2:
`computer(action='screenshot', region=[3840, 0, 3840, 2160])`

### 2. Element Interaction (pywinauto)
When using `pywinauto` or `computer` tool actions (click, type), coordinates are global. 
- If an element's `rectangle` shows an `L` (left) value >= 3840, it is on Monitor 2.
- To click the center of Monitor 2: `computer(action='mouse_click', x=5760, y=1080)`

### 3. Window Migration
To move a window to Monitor 2, use `hotkey(keys='win+shift+right')` or manually set its rectangle via `pywinauto`.

## Troubleshooting
If `computer(action='screen_info')` only reports one monitor, ignore it. The virtual screen is confirmed at 7680x2160. Always use the explicit regions above.
