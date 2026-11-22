# 游戏内素材

只复制实际选用文件；打包后的游戏应独立于共享库运行。

- `originals/`：选用的原始文件与其许可，避免包含未使用的大包。
- `generated/`：裁切、图集、压缩、换色等衍生产物；保留生成参数与脚本。
- `manifest.json`：每项登记 `id`、`files`、`source_url`、`author`、`version_or_revision`、`downloaded_on`、`license`、`license_file`、`sha256`、`changes`、`attribution`。

引擎若要求自己的资源布局，可以调整目录，但清单仍需能指向实际文件。运行时代码不要直接引用 `../../assets/`。

《兵锋未至》图集使用已打包的本地 WebP 和坐标文件。运行 `python tools/pack-art.py` 重建基础图集，使用 `--motion` 重建弓手与骑兵动作，使用 `--boss-motion` 重建断桥元帅动作。打包需要 FFmpeg。原图与生成提示词见 [图集制作记录](originals/nine-kingdoms/PROVENANCE.md)。
