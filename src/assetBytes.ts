// The bytes of a file bundled with the app (an example's image, say). The
// build puts a small file straight into the code as a data: address, which
// the page's Content-Security-Policy does not let fetch() read (connect-src),
// so such an address is decoded here instead.
export async function assetBytes(url: string): Promise<Uint8Array> {
  const inline = /^data:([^,]*),(.*)$/s.exec(url);
  if (inline) {
    if (inline[1].endsWith(';base64')) return Uint8Array.from(atob(inline[2]), (char) => char.charCodeAt(0));
    return new TextEncoder().encode(decodeURIComponent(inline[2]));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} could not be loaded (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
