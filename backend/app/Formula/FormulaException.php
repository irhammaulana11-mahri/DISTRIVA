<?php

namespace App\Formula;

/** Raised for syntax errors, unsupported constructs and evaluation errors (e.g. division by zero). */
class FormulaException extends \RuntimeException {}
