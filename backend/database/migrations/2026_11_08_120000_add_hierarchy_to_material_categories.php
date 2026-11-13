<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Two-level material categories (docs/62 §46): kategori -> subkategori (PLN ERP master "Subkategori Rev2": 11 categories, 64 subcategories). A material points at a LEAF:
// a subcategory, or a category that has no subcategories (the old flat categories keep working). The database refuses a third level and a material on a category that has children.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('material_categories', function (Blueprint $table) {
            $table->foreignUuid('parent_id')->nullable()->after('id')->constrained('material_categories')->restrictOnDelete();
            $table->index('parent_id');
        });

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_material_category_depth() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.parent_id IS NOT NULL THEN
                    IF NEW.parent_id = NEW.id THEN
                        RAISE EXCEPTION 'Kategori tidak boleh menjadi induk dirinya sendiri.';
                    END IF;
                    IF EXISTS (SELECT 1 FROM material_categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
                        RAISE EXCEPTION 'Kategori material hanya dua tingkat (kategori dan subkategori).';
                    END IF;
                    IF EXISTS (SELECT 1 FROM material_categories WHERE parent_id = NEW.id) THEN
                        RAISE EXCEPTION 'Kategori yang memiliki subkategori tidak dapat dijadikan subkategori.';
                    END IF;
                    IF EXISTS (SELECT 1 FROM materials WHERE category_id = NEW.parent_id) THEN
                        RAISE EXCEPTION 'Kategori induk sudah dipakai langsung oleh material; pindahkan materialnya ke subkategori dulu.';
                    END IF;
                END IF;
                RETURN NEW;
            END $$;
        SQL);
        DB::unprepared('CREATE TRIGGER trg_material_categories_depth BEFORE INSERT OR UPDATE OF parent_id ON material_categories FOR EACH ROW EXECUTE FUNCTION distriva_material_category_depth()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION distriva_material_on_leaf_category() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.category_id IS NOT NULL AND EXISTS (SELECT 1 FROM material_categories WHERE parent_id = NEW.category_id) THEN
                    RAISE EXCEPTION 'Material harus memakai subkategori, bukan kategori induk.';
                END IF;
                RETURN NEW;
            END $$;
        SQL);
        DB::unprepared('CREATE TRIGGER trg_materials_leaf_category BEFORE INSERT OR UPDATE OF category_id ON materials FOR EACH ROW EXECUTE FUNCTION distriva_material_on_leaf_category()');
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS trg_materials_leaf_category ON materials');
            DB::unprepared('DROP TRIGGER IF EXISTS trg_material_categories_depth ON material_categories');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_material_on_leaf_category()');
            DB::unprepared('DROP FUNCTION IF EXISTS distriva_material_category_depth()');
        }
        Schema::table('material_categories', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_id');
        });
    }
};
