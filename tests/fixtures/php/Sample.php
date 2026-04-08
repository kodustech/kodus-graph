<?php

namespace App\Services;

use App\Models\User;
use App\Contracts\Greetable;

interface Loggable
{
    public function log(string $message): void;
}

class UserService extends BaseService implements Greetable
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function greet(): string
    {
        return "Hello, " . $this->getName();
    }
}

function helperFunction(): void
{
    echo "helper";
}

class UserServiceTest extends TestCase
{
    public function testGetName(): void
    {
        $svc = new UserService("test");
        $this->assertEquals("test", $svc->getName());
    }
}
