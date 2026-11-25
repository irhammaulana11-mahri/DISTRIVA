<?php

namespace App\Services\EisReports;

/** APKT menolak token sesi (kedaluwarsa atau sesi ditutup): seluruh penarikan dihentikan karena permintaan berikutnya pasti ditolak juga. */
class ApktTokenRejected extends \RuntimeException {}
