// Orderings that show on screen must come out the same on the server and in the browser, or React hydrates a different list than the
// one the server rendered. `String.prototype.localeCompare` without a locale uses the runtime's own default, so a viewer whose locale
// sorts differently (sv-SE puts Å, Ä, Ö after Z) saw a different order from the server's. Pin the locale instead.
const names = new Intl.Collator("en");

// Alphabetical order for user-written names (rooms), identical for every viewer.
export const compareNames = (left: string, right: string) => names.compare(left, right);

// Order for machine-written text such as ISO timestamps and ids: plain code-unit order, no locale involved.
export const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
