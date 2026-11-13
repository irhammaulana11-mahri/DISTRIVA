<?php

namespace App\Services\Notifications;

use RuntimeException;

class GatewayFailure extends RuntimeException implements DisplaySafe {}
