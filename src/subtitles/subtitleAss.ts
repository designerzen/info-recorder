import { appSettings } from "../config/settings";

type SubtitleAssOptions = {
  durationSeconds?: number;
  fontFamily?: string;
  fontSize?: number;
  marginV?: number;
};

function buildAssHeader({
  fontFamily,
  fontSize,
  marginV
}: Required<Pick<SubtitleAssOptions, "fontFamily" | "fontSize" | "marginV">>) {
  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Live,${fontFamily},${fontSize},&H00FFFFFF,&H00FFFFFF,&H9A000000,&HAA000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

export function createLiveAssSubtitle(
  text: string,
  options: number | SubtitleAssOptions = {}
) {
  const normalizedOptions = typeof options === "number" ? { durationSeconds: options } : options;
  const durationSeconds = normalizedOptions.durationSeconds ?? appSettings.subtitles.assDurationSeconds;
  const cleanText = escapeAssText(text.trim() || " ");
  const assHeader = buildAssHeader({
    fontFamily: normalizedOptions.fontFamily ?? appSettings.subtitles.fontFamily,
    fontSize: normalizedOptions.fontSize ?? appSettings.subtitles.fontSize,
    marginV: normalizedOptions.marginV ?? appSettings.subtitles.marginV
  });
  return `${assHeader}
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
  const totalCentiseconds = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}
