Word Trail brings private recording and on-device transcription to your desktop.

### Downloads

| System | Choose this asset |
| --- | --- |
| Windows (Intel / AMD 64-bit) | `Word-Trail-<version>-windows-x64.exe` |
| macOS (Apple silicon) | `Word-Trail-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Word-Trail-<version>-mac-x64.dmg` |
| Linux (Intel / AMD 64-bit) | `Word-Trail-<version>-linux-x86_64.AppImage` or `Word-Trail-<version>-linux-amd64.deb` |

Windows: open the installer. macOS: open the disk image and drag Word Trail into Applications (ZIP archives are also provided). Linux: make the AppImage executable with `chmod +x Word-Trail-*.AppImage`, or install the Debian package with your package manager.

### Before installing

These community builds are unsigned on Windows and ad-hoc signed on macOS, without Apple notarization. Windows SmartScreen or macOS Gatekeeper may require approval or block installation. Follow your operating system’s guidance and install only if you trust the project.

Compare your download’s SHA-256 hash against `SHA256SUMS.txt`: use `Get-FileHash <file> -Algorithm SHA256` in PowerShell, `shasum -a 256 <file>` on macOS, or `sha256sum <file>` on Linux. Checksums detect corrupted downloads; they are not publisher signatures.

### First run

Allow microphone access when you record. Speech models download on first use and are cached on your device. No microphone audio or transcript text is uploaded for transcription. WebGPU depends on your hardware and drivers; browser translation may be unavailable. Desktop storage is separate from your browser profile. Export work you want to keep before clearing application data.

Install updates manually from this release page.
