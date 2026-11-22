import packed from '../../assets/generated/nine-kingdoms-sprites.json';

type Sprite = { column: number; row: number; frame: number[] };
const entries: Record<string, Sprite> = packed.sprites;
const atlasUrl = new URL('../../assets/generated/nine-kingdoms-sprites.webp', import.meta.url).href;
const image = typeof Image === 'undefined' ? undefined : new Image();
if (image) {
  // The offline URL contains the entire atlas. Share it across all card thumbnails.
  const cardAtlas = document.createElement('style');
  cardAtlas.textContent = `.card-sprite { background-image: url("${atlasUrl}"); }`;
  document.head.append(cardAtlas);
  image.addEventListener('load', () => { document.documentElement.dataset.atlasReady = 'true'; }, { once: true });
  image.src = atlasUrl;
}

export function renderAtlasPortrait(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  if (image?.complete === false) image.addEventListener('load', () => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx);
  }, { once: true });
}

/** Draw a trimmed cell with a centered horizontal and bottom vertical anchor. */
export function drawSprite(ctx: CanvasRenderingContext2D, id: string, x: number, bottom: number, maxWidth: number, maxHeight: number): boolean {
  const sprite = entries[id];
  if (!image?.complete || !image.naturalWidth || !sprite) return false;
  const [u, v, sourceWidth, sourceHeight] = sprite.frame;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const smooth = ctx.imageSmoothingEnabled;
  if (smooth) ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, u, v, sourceWidth, sourceHeight, Math.round(x - width / 2), Math.round(bottom - height), width, height);
  if (smooth) ctx.imageSmoothingEnabled = true;
  return true;
}

export function spriteCard(id: string, glyph: string): string {
  const sprite = entries[id];
  if (!sprite) return `<span class="card-glyph">${glyph}</span>`;
  const x = sprite.column * 100 / (packed.columns - 1);
  const y = sprite.row * 100 / (packed.rows - 1);
  return `<span class="card-glyph">${glyph}</span><span class="card-sprite" data-sprite="${id}" style="background-size:${packed.columns * 100}% ${packed.rows * 100}%;background-position:${x}% ${y}%"></span>`;
}
