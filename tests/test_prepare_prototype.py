"""Pure dimension policy checks; no NAS access or image generation."""
import unittest

from tools.prepare_prototype import tile_dimensions


class TileDimensionsTests(unittest.TestCase):
    def test_odd_native_size_keeps_exact_4k_preview_lod(self):
        # Native exceeds the 128 MiB texture pool; its half-size is below 4K.
        levels = tile_dimensions(7521,5151,(3840,2630))
        self.assertIn((3840,2630),levels)
        self.assertEqual(levels,[(1881,1288),(3761,2576),(3840,2630),(7521,5151)])
        self.assertLess(3840*2630*4*2,128*1024*1024)

    def test_portrait_preview_lod_preserves_measured_orientation(self):
        levels = tile_dimensions(5151,7521,(2630,3840))
        self.assertIn((2630,3840),levels)
        self.assertEqual(levels[-1],(5151,7521))

    def test_existing_level_is_deduplicated_and_small_source_is_not_upscaled(self):
        levels = tile_dimensions(7680,5120,(3840,2560))
        self.assertEqual(levels.count((3840,2560)),1)
        self.assertEqual(tile_dimensions(1200,800,(1200,800)),[(1200,800)])
        with self.assertRaises(ValueError):tile_dimensions(1200,800,(3840,2560))


if __name__ == "__main__":unittest.main()
