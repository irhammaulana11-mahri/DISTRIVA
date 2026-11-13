<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\RateLimiter;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class ThrottleBucketsTest extends TestCase
{
    #[Test]
    public function reads_have_their_own_generous_bucket_and_writes_stay_at_sixty_per_minute(): void
    {
        $limiter = RateLimiter::limiter('admin');
        $user = new User;
        $user->id = 'u-1';

        $get = \Illuminate\Http\Request::create('/x', 'GET');
        $get->setUserResolver(fn () => $user);
        $post = \Illuminate\Http\Request::create('/x', 'POST');
        $post->setUserResolver(fn () => $user);

        $read = $limiter($get);
        $write = $limiter($post);
        $this->assertSame(600, $read->maxAttempts);
        $this->assertSame(60, $write->maxAttempts);
        $this->assertNotSame($read->key, $write->key);
    }
}
