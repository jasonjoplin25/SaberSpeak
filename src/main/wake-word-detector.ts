const WAKE_PHRASES = ['wake up', 'wakeup', 'wake-up'];
const STOP_PHRASES = ['stop listening', 'stop listen'];
const ALL_CAPS_ON_PHRASES = [/\ball caps\b(?!\s+(?:that|off))/i];
const ALL_CAPS_OFF_PHRASES = [/\b(all caps off|stop all caps|no more caps)\b/i];
const ALL_CAPS_THAT_PHRASE = /\ball caps that\b/i;

export function isWakeWord(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  return WAKE_PHRASES.some((p) => t.includes(p));
}

export function isStopCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  return STOP_PHRASES.some((p) => t.includes(p));
}

export function stripWakeWord(transcript: string): string {
  let s = transcript;
  for (const phrase of WAKE_PHRASES) {
    s = s.replace(new RegExp(`\\b${phrase}\\b`, 'gi'), '');
  }
  return s.trim();
}

export function detectAllCapsCommands(transcript: string): {
  allCapsOn: boolean;
  allCapsOff: boolean;
  allCapsThat: boolean;
  text: string;
} {
  let text = transcript;

  if (ALL_CAPS_THAT_PHRASE.test(text)) {
    text = text.replace(ALL_CAPS_THAT_PHRASE, '').trim();
    return { allCapsOn: false, allCapsOff: false, allCapsThat: true, text };
  }

  if (ALL_CAPS_OFF_PHRASES[0]!.test(text)) {
    text = text.replace(ALL_CAPS_OFF_PHRASES[0]!, '').trim();
    return { allCapsOn: false, allCapsOff: true, allCapsThat: false, text };
  }

  if (ALL_CAPS_ON_PHRASES[0]!.test(text)) {
    text = text.replace(ALL_CAPS_ON_PHRASES[0]!, '').trim();
    return { allCapsOn: true, allCapsOff: false, allCapsThat: false, text };
  }

  return { allCapsOn: false, allCapsOff: false, allCapsThat: false, text };
}
