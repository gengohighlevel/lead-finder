/** A business name has at least two letters in a row. "10" or "505" is a unit number on a map, not a business. */
export const hasRealName = (name: string | undefined): boolean => typeof name === 'string' && /\p{L}{2}/u.test(name);
