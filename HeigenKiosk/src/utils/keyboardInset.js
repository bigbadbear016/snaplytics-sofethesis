// Part of the keyboard that still covers a container. Some Android windows (Expo Go,
// modals) shrink when the keyboard opens and some (edge-to-edge builds) don't; padding by
// the full keyboard height in a shrunk window pushes centered dialogs off-screen.
export function keyboardInset(keyboardH, fullH, hostH) {
    const shrink = Math.max(0, fullH - hostH);
    return Math.max(0, keyboardH - shrink);
}
