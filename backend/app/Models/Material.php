<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Only the import service creates materials; the fillable list excludes `code` so no request can set it.
#[Fillable(['category_id', 'name', 'unit', 'spec', 'is_active'])]
class Material extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'external_updated_at' => 'datetime'];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(MaterialCategory::class, 'category_id');
    }
}
