import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('inventory',Path(__file__).parents[1]/'tools/inventory.py')
inventory=importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class InventoryTests(unittest.TestCase):
    def test_dates_and_formats(self):
        self.assertEqual(inventory.parse_event('2024-全年总结')['month'],None)
        self.assertEqual(inventory.parse_event('2024-10-长三角-自驾')['theme'],'长三角-自驾')
        self.assertEqual(inventory.classify('DSC.HIF'),'image_candidate')
        self.assertEqual(inventory.classify('DSC.ARW'),'raw')
        self.assertEqual(inventory.excluded_directory('原片-富士'),'originals_directory')
        self.assertIsNone(inventory.excluded_directory('drawings'))
        self.assertIsNone(inventory.excluded_directory('底片扫描成片'))
        self.assertEqual(inventory.classify('clip.webm'),'video_candidate')

    def test_empty_activity_and_activity_title_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);root=base/'source';root.mkdir()
            (root/'2024-空活动').mkdir()
            event=root/'2024-10-底片扫描成片';event.mkdir()
            (event/'export.JPG').write_bytes(b'fixture')
            db=inventory.connect(base/'inventory.sqlite3')
            run=inventory.begin(db,root)
            inventory.scan(db,run,root,2)
            report=inventory.summary(db,run)
            self.assertEqual(report['event_count'],2)
            self.assertEqual(report['events_with_entries'],1)
            self.assertEqual(report['kinds']['image_candidate'],1)

    def test_resume_new_directories_and_live_photo_ambiguity(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp); root=base/'source'; root.mkdir()
            event=root/'2024-10-旅行'; event.mkdir()
            for name in ['A.HEIC','A.MOV','B.JPG','B.HEIC','B.MOV','video.MP4','D.ARW']:
                (event/name).write_bytes(b'synthetic fixture')
            raw=event/'原片'; raw.mkdir(); (raw/'ignored.JPG').write_bytes(b'raw')
            db=inventory.connect(base/'inventory.sqlite3')
            run=inventory.begin(db,root)
            inventory.scan(db,run,root,1,1)
            self.assertEqual(inventory.summary(db,run)['run']['status'],'partial')
            resumed=inventory.begin(db,root,True)
            self.assertEqual(run,resumed)
            inventory.scan(db,run,root,2)
            result=inventory.summary(db,run)
            self.assertEqual(result['run']['status'],'complete')
            self.assertEqual(result['kinds']['image_candidate'],3)
            self.assertEqual(result['live_photo_filename_pairs'],1)
            self.assertEqual(result['ambiguous_live_photo_groups'],1)
            self.assertEqual(result['directory_states']['excluded'],1)
            new=root/'2025-新活动';new.mkdir();(new/'NEW.HEIC').write_bytes(b'new')
            second=inventory.begin(db,root)
            inventory.scan(db,second,root,2)
            self.assertEqual(inventory.summary(db,second)['event_count'],2)
            # Previous evidence remains intact; this census never reconciles deletions.
            self.assertEqual(inventory.summary(db,run)['event_count'],1)

    def test_failure_remains_partial_and_does_not_erase_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'source';root.mkdir()
            db=inventory.connect(Path(tmp)/'inventory.sqlite3')
            run=inventory.begin(db,root)
            root.rmdir()
            inventory.scan(db,run,root,1)
            self.assertEqual(inventory.summary(db,run)['run']['status'],'partial')
            self.assertEqual(len(inventory.summary(db,run)['errors']),1)
            root.mkdir()
            inventory.begin(db,root,True)
            inventory.scan(db,run,root,1)
            self.assertEqual(inventory.summary(db,run)['run']['status'],'complete')


if __name__=='__main__':
    unittest.main()
