export function isEmailAddress(value: string): boolean {
  if (value.length < 3 || value.length > 254) return false;

  let atIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character.trim() === "") return false;
    if (character === "@") {
      if (atIndex !== -1) return false;
      atIndex = index;
    }
  }

  if (atIndex <= 0 || atIndex >= value.length - 3) return false;
  const dotIndex = value.indexOf(".", atIndex + 2);
  return dotIndex > atIndex + 1 && dotIndex < value.length - 1;
}
