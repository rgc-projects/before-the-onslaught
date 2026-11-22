"""Pack the original Before the Onslaught pixel art for the browser. Requires FFmpeg."""

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / 'assets/originals/nine-kingdoms'
OUTPUT = ROOT / 'assets/generated'
CELL = 96
COLUMNS = 6
MOTION_CELL = (64, 54)
MOTION_BASELINE = 50
MOTION_SHEETS = {
    'archer': ('archer-motion-v1.png', 32, 38),
    'lancer': ('lancer-motion-v1.png', 44, 44),
}

SHEETS = (
    ('structures-v1.png', (0, 314, 627, 940, 1254), (0, 314, 627, 940, 1254), (
        'watch', 'farm', 'wall', 'keep', 'mine', 'market', 'storehouse', 'barracks',
        'stable', 'bowcamp', 'magetower', 'arcanetower', 'bombard', 'shrine', 'lab', 'hall',
    )),
    ('units-v1.png', (0, 280, 561, 841, 1105, 1402), (0, 280, 561, 828, 1122), (
        'guard', 'spear', 'archer', 'lancer', 'mage', 'sentinel', 'stalker', 'colossus', 'medic', 'summoner',
        'drake', 'waykeeper', 'raider', 'breaker', 'skirmisher', 'rider', 'hexer', 'ogre', 'captain', 'marshal',
    )),
    ('moon-altar-v1.png', (0, 1536), (0, 1024), ('altar',)),
    ('mandates-v1.png', (0, 397, 793, 1190, 1586, 1983), (0, 396, 793), (
        'ember', 'timber', 'trade', 'rations', 'forge-seal',
        'star-mason', 'timber-plus', 'trade-plus', 'rations-plus', 'archive-cache',
    )),
)


def read_rgba(path):
    return subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-frames:v', '1',
        '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
    ])


def trim(source, stride, cell):
    left, top, right, bottom = cell
    core = [(x, y) for y in range(top, bottom) for x in range(left, right)
            if source[(y * stride + x) * 4 + 3] >= 140]
    if not core:
        raise ValueError(f'Empty source cell {cell}')
    xs, ys = zip(*core)
    return (max(left, min(xs) - 2), max(top, min(ys) - 2),
            min(right, max(xs) + 3), min(bottom, max(ys) + 3))


def bake(source, stride, bounds, sheet, sheet_width, frame):
    left, top, right, bottom = bounds
    put_x, put_y, wide, high = frame
    for y in range(high):
        for x in range(wide):
            # Four local samples preserve clustered details without spreading hidden RGB at the edge.
            red = green = blue = alpha = 0
            for dy in (0.25, 0.75):
                py = top + int((y + dy) * (bottom - top) / high)
                for dx in (0.25, 0.75):
                    px = left + int((x + dx) * (right - left) / wide)
                    offset = (py * stride + px) * 4
                    sample_red, sample_green, sample_blue, sample_alpha = source[offset:offset + 4]
                    if sample_alpha <= 12:
                        continue
                    alpha += sample_alpha
                    red += sample_red * sample_alpha
                    green += sample_green * sample_alpha
                    blue += sample_blue * sample_alpha
            if alpha:
                offset = ((put_y + y) * sheet_width + put_x + x) * 4
                sheet[offset:offset + 4] = bytes((red // alpha, green // alpha, blue // alpha, round(alpha / 4)))


def main():
    rows = (sum(len(ids) for _, _, _, ids in SHEETS) + COLUMNS - 1) // COLUMNS
    width, height = (COLUMNS * CELL, rows * CELL)
    sheet = bytearray(width * height * 4)
    sprites = {}
    for source_name, x_marks, y_marks, ids in SHEETS:
        source = read_rgba(ORIGINAL / source_name)
        stride = x_marks[-1]
        if len(source) != stride * y_marks[-1] * 4:
            raise ValueError(f'Source dimensions changed for {source_name}')
        for slot, sprite_id in enumerate(ids):
            row, col = divmod(slot, len(x_marks) - 1)
            bounds = trim(source, stride, (x_marks[col], y_marks[row], x_marks[col + 1], y_marks[row + 1]))
            left, top, right, bottom = bounds
            scale = min((CELL - 10) / (right - left), (CELL - 12) / (bottom - top))
            wide, high = round((right - left) * scale), round((bottom - top) * scale)
            sheet_row, sheet_col = divmod(len(sprites), COLUMNS)
            frame = (sheet_col * CELL + (CELL - wide) // 2, sheet_row * CELL + CELL - high - 6, wide, high)
            bake(source, stride, bounds, sheet, width, frame)
            sprites[sprite_id] = {'column': sheet_col, 'row': sheet_row, 'frame': frame}
    write_webp(sheet, width, height, 'nine-kingdoms-sprites')
    keep = sprites['keep']
    x, y = keep['column'] * CELL, keep['row'] * CELL
    rows_of_pixels = (sheet[(row * width + x) * 4:(row * width + x + CELL) * 4] for row in range(y, y + CELL))
    write_webp(b''.join(rows_of_pixels), CELL, CELL, 'menu-crest')
    manifest = {'cell': CELL, 'columns': COLUMNS, 'rows': rows, 'sprites': sprites}
    (OUTPUT / 'nine-kingdoms-sprites.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Packed {len(sprites)} sprites on a {width}×{height} atlas.')


def pack_motion():
    source_width, source_height = 1774, 887
    walk_frames, action_frames = 6, 2
    count = walk_frames + action_frames
    cell_width, cell_height = MOTION_CELL
    width, height = count * cell_width, len(MOTION_SHEETS) * cell_height
    sheet = bytearray(width * height * 4)
    rows = {}
    for row, (unit, (filename, target_width, target_height)) in enumerate(MOTION_SHEETS.items()):
        data = read_rgba(ORIGINAL / filename)
        if len(data) != source_width * source_height * 4:
            raise ValueError(f'Unexpected motion sheet dimensions for {filename}')
        bounds = [trim(data, source_width, (column * source_width // 4, line * source_height // 2,
                  (column + 1) * source_width // 4, (line + 1) * source_height // 2))
                  for line in range(2) for column in range(4)]
        scale = min(target_width / max(bounds[i][2] - bounds[i][0] for i in range(walk_frames)),
                    target_height / max(bottom - top for _, top, _, bottom in bounds))
        for column, crop in enumerate(bounds):
            left, top, right, bottom = crop
            wide = round((right - left) * scale)
            high = round((bottom - top) * scale)
            if wide > cell_width or high > MOTION_BASELINE:
                raise ValueError(f'Motion frame too large: {unit} {column}')
            frame = (column * cell_width + (cell_width - wide) // 2, row * cell_height + MOTION_BASELINE - high, wide, high)
            bake(data, source_width, crop, sheet, width, frame)
        rows[unit] = row
    write_webp(sheet, width, height, 'unit-motion')
    manifest = dict(cellWidth=cell_width, cellHeight=cell_height, baseline=MOTION_BASELINE,
                    walkFrames=walk_frames, actionFrames=action_frames, rows=rows)
    (OUTPUT / 'unit-motion.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Packed {len(rows) * count} motion frames on a {width}×{height} atlas.')


def pack_boss_motion():
    filename = ORIGINAL / 'marshal-motion-v1.png'
    source_width, source_height = 1448, 1086
    columns, rows = 4, 3
    source_cell_width, source_cell_height = source_width // columns, source_height // rows
    cell_width, cell_height, baseline = 84, 68, 64
    walk_frames, action_frames, slam_frames = 6, 3, 3
    count = walk_frames + action_frames + slam_frames
    data = read_rgba(filename)
    if len(data) != source_width * source_height * 4:
        raise ValueError(f'Unexpected motion sheet dimensions for {filename.name}')
    bounds = [trim(data, source_width, (column * source_cell_width, row * source_cell_height,
              (column + 1) * source_cell_width, (row + 1) * source_cell_height))
              for row in range(rows) for column in range(columns)]
    scale = min(59 / max(right - left for left, _, right, _ in bounds[:walk_frames]),
                58 / max(bottom - top for _, top, _, bottom in bounds))
    width = count * cell_width
    sheet = bytearray(width * cell_height * 4)
    for slot, (left, top, right, bottom) in enumerate(bounds):
        wide, high = round((right - left) * scale), round((bottom - top) * scale)
        center = slot % columns * source_cell_width + 193
        x = cell_width // 2 + round((left - center) * scale)
        if x < 0 or x + wide > cell_width or high > baseline:
            raise ValueError(f'Marshal frame {slot + 1} exceeds its output cell')
        bake(data, source_width, (left, top, right, bottom), sheet, width,
             (slot * cell_width + x, baseline - high, wide, high))
    write_webp(sheet, width, cell_height, 'marshal-motion')
    manifest = dict(cellWidth=cell_width, cellHeight=cell_height, baseline=baseline,
                    walkFrames=walk_frames, actionFrames=action_frames, slamFrames=slam_frames)
    (OUTPUT / 'marshal-motion.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Packed {count} marshal motion frames on a {width}×{cell_height} atlas.')


def pack_captain_motion():
    source_size, cell_size = 1254, 418
    cell_width, cell_height, baseline = 64, 54, 50
    walk_frames, action_frames = 6, 3
    count = walk_frames + action_frames
    data = read_rgba(ORIGINAL / 'captain-motion-v1.png')
    if len(data) != source_size * source_size * 4:
        raise ValueError('Unexpected captain motion sheet dimensions')

    bounds = []
    for row in range(3):
        # The pick extends left of the source grid during the lunge.
        edges = (0, 390, 842, source_size) if row == 2 else (0, 418, 836, source_size)
        for column in range(3):
            bounds.append(trim(data, source_size, (edges[column], row * cell_size,
                                                   edges[column + 1], (row + 1) * cell_size)))
    scale = min(32 / max(right - left for left, _, right, _ in bounds[:walk_frames]),
                35 / max(bottom - top for _, top, _, bottom in bounds))
    width = count * cell_width
    sheet = bytearray(width * cell_height * 4)
    for slot, crop in enumerate(bounds):
        left, top, right, bottom = crop
        wide, high = round((right - left) * scale), round((bottom - top) * scale)
        center = (slot % 3) * cell_size + cell_size // 2
        x = cell_width // 2 + round((left - center) * scale)
        if x < 0 or x + wide > cell_width or high > baseline:
            raise ValueError(f'Captain frame {slot + 1} exceeds its output cell')
        bake(data, source_size, crop, sheet, width, (slot * cell_width + x, baseline - high, wide, high))

    write_webp(sheet, width, cell_height, 'captain-motion')
    manifest = dict(cellWidth=cell_width, cellHeight=cell_height, baseline=baseline,
                    walkFrames=walk_frames, actionFrames=action_frames, idleFrame=count - 1)
    (OUTPUT / 'captain-motion.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Packed {count} captain motion frames on a {width}×{cell_height} atlas.')


def pack_spear_motion():
    source_size, source_cell = 1254, 418
    cell_width, cell_height, baseline = 64, 54, 50
    walk_frames, action_frames = 6, 3
    count = walk_frames + action_frames
    data = read_rgba(ORIGINAL / 'spear-motion-v1.png')
    if len(data) != source_size * source_size * 4:
        raise ValueError('Unexpected spear motion sheet dimensions')

    bounds = []
    for row in range(3):
        # The extended spear crosses the nominal boundary between the first two source columns.
        edges = (0, 389, 850, source_size) if row == 2 else (0, 418, 836, source_size)
        for column in range(3):
            bounds.append(trim(data, source_size, (edges[column], row * source_cell,
                                                   edges[column + 1], (row + 1) * source_cell)))
    body_centers = (235, 615, 1012, 232, 617, 1011, 253, 671, 1057)
    scale = 38 / max(bottom - top for _, top, _, bottom in bounds[:walk_frames])
    width = count * cell_width
    sheet = bytearray(width * cell_height * 4)
    # Damage resolves on the attack event. Show the extended weapon first, then pull back and settle.
    for slot, source_slot in enumerate((0, 1, 2, 3, 4, 5, 7, 6, 8)):
        crop = bounds[source_slot]
        left, top, right, bottom = crop
        wide, high = round((right - left) * scale), round((bottom - top) * scale)
        x = cell_width // 2 + round((left - body_centers[source_slot]) * scale)
        if x < 0 or x + wide > cell_width or high > baseline:
            raise ValueError(f'Spear frame {source_slot + 1} exceeds its output cell')
        bake(data, source_size, crop, sheet, width, (slot * cell_width + x, baseline - high, wide, high))

    write_webp(sheet, width, cell_height, 'spear-motion')
    manifest = dict(cellWidth=cell_width, cellHeight=cell_height, baseline=baseline,
                    walkFrames=walk_frames, actionFrames=action_frames, idleFrame=count - 1)
    (OUTPUT / 'spear-motion.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Packed {count} spear motion frames on a {width}×{cell_height} atlas.')


def write_webp(sheet, width, height, name):
    OUTPUT.mkdir(exist_ok=True)
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}',
        '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6',
        str(OUTPUT / f'{name}.webp'),
    ], input=sheet, check=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['--motion']:
        pack_motion()
    elif sys.argv[1:] == ['--boss-motion']:
        pack_boss_motion()
    elif sys.argv[1:] == ['--captain-motion']:
        pack_captain_motion()
    elif sys.argv[1:] == ['--spear-motion']:
        pack_spear_motion()
    else:
        main()
