import { appSettings } from "../config/settings";

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Live,${appSettings.subtitles.fontFamily},${appSettings.subtitles.fontSize},&H00FFFFFF,&H00FFFFFF,&H9A000000,&HAA000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,${appSettings.subtitles.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

export function createLiveAssSubtitle(
  text: string,
  durationSeconds = appSettings.subtitles.assDurationSeconds
) {
  const cleanText = escapeAssText(text.trim() || " ");
  return `${ASS_HEADER}
Dialogue: 0,0:00:00.00,${formatAssTime(durationSeconds)},Live,,0,0,0,,${cleanText}`;
}

function escapeAssText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\r\n", "\\N")
    .replaceAll("\n", "\\N");
}

function formatAssTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds % 1) * 100);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}
