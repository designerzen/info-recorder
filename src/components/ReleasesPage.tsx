import { ArrowLeft, ArrowUpRight, Download, Laptop, Monitor, Package, ShieldCheck } from 'lucide-react';

const releasesUrl = 'https://github.com/designerzen/info-recorder/releases';

export function ReleasesPage() {
  return (
    <article className="help-page releases-page" aria-labelledby="releases-title">
      <header className="help-intro">
        <span className="section-eyebrow">WORD TRAIL / DESKTOP</span>
        <h1 id="releases-title" tabIndex={-1}>A little space.<br /><em>Now on your desktop.</em></h1>
        <p>Keep Word Trail close. Record audio, turn speech into text, and save your work from a dedicated desktop app.</p>
        <a className="release-primary" href={`${releasesUrl}/latest`} target="_blank" rel="noreferrer"><Download size={20} aria-hidden="true" /> View latest release <ArrowUpRight size={18} aria-hidden="true" /></a>
        <a className="help-back" href="#recorder"><ArrowLeft size={18} aria-hidden="true" /> Back to recorder</a>
      </header>
      <div className="release-platforms" aria-label="Desktop downloads">
        <section aria-labelledby="download-windows"><Monitor aria-hidden="true" /><h2 id="download-windows">Windows</h2><p>64-bit Intel & AMD</p><p>Download the <strong>windows-x64.exe</strong> installer from the release assets. Choose your install folder and launch Word Trail.</p></section>
        <section aria-labelledby="download-mac"><Laptop aria-hidden="true" /><h2 id="download-mac">macOS</h2><p>Apple silicon & Intel</p><p>Choose <strong>mac-arm64.dmg</strong> for Apple silicon or <strong>mac-x64.dmg</strong> for Intel. Open the disk image and drag Word Trail into Applications.</p></section>
        <section aria-labelledby="download-linux"><Package aria-hidden="true" /><h2 id="download-linux">Linux</h2><p>64-bit Intel & AMD</p><p>Choose <strong>linux-x86_64.AppImage</strong> or the <strong>linux-amd64.deb</strong> package. Make the AppImage executable before opening it.</p></section>
      </div>
      <div className="help-sections">
        <section aria-labelledby="release-local"><span className="section-eyebrow"><ShieldCheck size={16} aria-hidden="true" /> ON YOUR DEVICE</span><h2 id="release-local">Your words stay with you</h2><p>Transcription runs on your device. An internet connection is needed for the first model download; cached models can be reused offline. Desktop storage is separate from the browser app. Export anything you want to keep before clearing application data.</p><p>Microphone access is requested when you record. WebGPU features depend on your graphics hardware and drivers. Browser translation may be unavailable in the desktop app.</p></section>
        <section aria-labelledby="release-install"><span className="section-eyebrow">BEFORE YOU INSTALL</span><h2 id="release-install">Community builds</h2><p>Release builds currently have no verified publisher signature or Apple notarization. Windows SmartScreen or macOS Gatekeeper may require approval or block installation. Install only if you trust this project; follow your operating system’s guidance.</p><p>Each release includes installation notes and a <strong>SHA256SUMS.txt</strong> file to check the integrity of the download. Updates are installed manually from GitHub Releases.</p><a className="help-back" href={releasesUrl} target="_blank" rel="noreferrer">All releases & release notes <ArrowUpRight size={18} aria-hidden="true" /></a><p>If no published release is available yet, this link shows the project’s release history. Downloads appear after a release is published.</p></section>
      </div>
    </article>
  );
}
