import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location(
    "generate_composites", Path(__file__).resolve().parent.parent / "tools" / "generate_composites.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class CompositeGeneratorTests(unittest.TestCase):
    def test_urban_pickups_preserve_the_floor_under_transparent_pixels(self):
        images = generator.load_sources()
        for item, floor, source in ((154, 47, "pickups"),):
            recipe = {"biome": "urban", "kind": "normal", "layers": [
                {"source": "urban", "tile": floor, "attr": 0, "x": 0, "y": 0},
                {"source": source, "tile": item, "attr": 0, "x": 0, "y": 0},
            ]}
            actual = generator.compose(recipe, images)
            background = generator.image_tile(images["urban"], floor)
            overlay = generator.image_tile(images["urban-transparent"], item)
            transparent = [(x, y) for y in range(8) for x in range(8) if overlay.getpixel((x, y))[3] == 0]
            self.assertTrue(transparent)
            for position in transparent:
                self.assertEqual(actual.getpixel(position), background.getpixel(position))

    def test_urban_map_layers_use_the_edited_opaque_tiles_and_alerts_remain_transparent(self):
        images = generator.load_sources()
        recipe = {"biome": "urban", "kind": "normal", "layers": [
            {"source": "urban", "tile": 39, "attr": 0, "x": 0, "y": 0},
            {"source": "urban", "tile": 29, "attr": 0, "x": 0, "y": 0},
        ]}
        self.assertEqual(generator.compose(recipe, images).tobytes(),
                         generator.image_tile(images["urban"], 29).tobytes())
        recipe["layers"].append({"source": "urban", "tile": 93, "attr": 0, "x": 0, "y": 0})
        expected = generator.image_tile(images["urban"], 29)
        expected.alpha_composite(generator.image_tile(images["urban-transparent"], 93))
        self.assertEqual(generator.compose(recipe, images).tobytes(), expected.tobytes())

    def test_other_biomes_keep_urban_overlays_transparent(self):
        images = generator.load_sources()
        recipe = {"biome": "desert", "kind": "special", "layers": [
            {"source": "desert", "tile": 49, "attr": 0, "x": 0, "y": 0},
            {"source": "urban", "tile": 29, "attr": 0, "x": 0, "y": 0},
        ]}
        expected = generator.image_tile(images["desert"], 49)
        expected.alpha_composite(generator.image_tile(images["urban-transparent"], 29))
        self.assertEqual(generator.compose(recipe, images).tobytes(), expected.tobytes())

    def test_transparent_floor_uses_the_biome_specific_tile_ids(self):
        image = Image.new("RGBA", (256, 64), (*generator.PALETTE[0], 255))
        urban = generator.transparent_floor(image, generator.URBAN_FLOOR_TILES)
        desert = generator.transparent_floor(image, generator.FLOOR_TILES)
        for tile in (64, 65, 66, 67, 69):
            self.assertEqual(generator.image_tile(urban, tile).getpixel((0, 0))[3], 255)
            self.assertEqual(generator.image_tile(desert, tile).getpixel((0, 0))[3], 0)
        for tile in (70, 71, 72):
            self.assertEqual(generator.image_tile(urban, tile).getpixel((0, 0))[3], 0)

    def test_flip_offset_transparency_and_2bpp(self):
        floor = Image.new("RGBA", (256, 64), (*generator.PALETTE[0], 255))
        overlay = Image.new("RGBA", (256, 64))
        overlay.putpixel((0, 0), (*generator.PALETTE[3], 255))
        recipe = {
            "biome": "urban", "kind": "normal",
            "layers": [
                {"source": "urban", "tile": 0, "attr": 0, "x": 0, "y": 0},
                {"source": "pickups", "tile": 0, "attr": 32, "x": 0, "y": 1},
            ],
        }
        data, preview = generator.encode_tile(generator.compose(recipe, {"urban": floor, "pickups": overlay}))
        self.assertEqual(preview.getpixel((7, 1)), generator.PALETTE[3])
        self.assertEqual(data[2:4], bytes((1, 1)))
        self.assertEqual(sum(data), 2)

    def test_existing_numbers_survive_reordering_and_new_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "maps").mkdir()
            paths = {}
            for biome in generator.BIOMES:
                paths[biome] = root / "assets" / f"{biome}.png"
                Image.new("RGBA", (256, 64), (*generator.PALETTE[0], 255)).save(paths[biome])
            paths["urban-transparent"] = root / "assets" / "urban-transparent.png"
            Image.new("RGBA", (256, 64), (*generator.PALETTE[0], 255)).save(paths["urban-transparent"])
            original = {key: getattr(generator, key) for key in
                        ("OBSERVATIONS", "REQUIRED", "MANIFEST", "ATLAS", "BINARY", "UNIQUE_ATLAS", "UNIQUE_BINARY", "ASSET_PATHS")}
            try:
                generator.OBSERVATIONS = root / "observations.json"
                generator.REQUIRED = root / "required.json"
                generator.REQUIRED.write_text(json.dumps({"version": 1, "combinations": []}))
                generator.MANIFEST = root / "maps" / "catalog.json"
                generator.ATLAS = root / "assets" / "tiles.png"
                generator.BINARY = root / "assets" / "tiles.2bpp"
                generator.UNIQUE_ATLAS = root / "assets" / "unique.png"
                generator.UNIQUE_BINARY = root / "assets" / "unique.2bpp"
                generator.ASSET_PATHS = paths
                recipe = lambda tile: {"biome": "urban", "kind": "normal", "layers": [
                    {"source": "urban", "tile": tile, "attr": 0, "x": 0, "y": 0}
                ]}
                generator.OBSERVATIONS.write_text(json.dumps({"version": 1, "combinations": [recipe(1), recipe(2)]}))
                generator.main()
                generator.OBSERVATIONS.write_text(json.dumps({"version": 1, "combinations": [recipe(2), recipe(3)]}))
                generator.main()
                manifest = json.loads(generator.MANIFEST.read_text())
                self.assertEqual([tile["recipe"]["layers"][0]["tile"] for tile in manifest["tiles"]], [1, 2, 3])
                self.assertEqual([tile["offset"] for tile in manifest["tiles"]], [0, 16, 32])
                self.assertEqual(len(generator.BINARY.read_bytes()), 48)
            finally:
                for key, value in original.items():
                    setattr(generator, key, value)


if __name__ == "__main__":
    unittest.main()
