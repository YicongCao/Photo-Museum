"""Behavioral checks for the bounded media experiment; no NAS access."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("media_probe", Path(__file__).parents[1] / "tools/media_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class MediaProbeTests(unittest.TestCase):
    def test_dimensions_keep_aspect_without_upscaling(self):
        self.assertEqual(probe.target_size(6000, 4000, 3840), (3840, 2560))
        self.assertEqual(probe.target_size(1200, 1800, 3840), (1200, 1800))
        self.assertEqual(probe.target_size(4000, 6000, 640), (427, 640))

    def test_hdr_is_deferred_instead_of_truncated(self):
        self.assertIsNotNone(probe.hdr_reason({}, {"transfer_characteristics": 16}))
        self.assertIsNotNone(probe.hdr_reason({"HDRHeadroom": 2.0}))
        self.assertIsNotNone(probe.hdr_reason({}, {}, ["urn:com:apple:photo:2020:aux:hdrgainmap"]))
        self.assertIsNotNone(probe.hdr_reason({"ProfileDescription": "Rec2100 HLG"}))
        self.assertIsNone(probe.hdr_reason({"ProfileDescription": "Display P3"}))

    def test_sdr_output_has_icc_but_no_source_exif(self):
        from PIL import Image, ImageCms
        with tempfile.TemporaryDirectory() as temporary:
            p = Path(temporary)
            source = Image.new("RGB", (120, 80), (170, 90, 30))
            exif = Image.Exif()
            exif[315] = "private photographer"
            source.save(p / "source.jpg", exif=exif,
                        icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
            result = probe.convert_photo(p / "source.jpg", p / "out", {})
            self.assertEqual(result["status"], "ok_sdr")
            with Image.open(p / "out/display.webp") as converted:
                self.assertEqual(converted.size, (120, 80))
                self.assertTrue(converted.info.get("icc_profile"))
                self.assertFalse(converted.getexif())

    def test_unknown_color_is_not_claimed_srgb(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temporary:
            p = Path(temporary)
            Image.new("RGB", (10, 10)).save(p / "source.jpg")
            self.assertEqual(probe.convert_photo(p / "source.jpg", p / "out", {})["status"], "deferred_color")


if __name__ == "__main__":
    unittest.main()
