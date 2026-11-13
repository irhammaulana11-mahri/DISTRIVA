<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class AssignRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // authorization is done by AdministrationAuthorizer in the controller
    }

    public function rules(): array
    {
        return [
            'user_id' => ['required', 'uuid', 'exists:users,id'],
            'role_id' => ['required', 'integer', 'exists:roles,id'],
            'organizational_unit_id' => ['required', 'uuid', 'exists:organizational_units,id'],
            'valid_from' => ['required', 'date_format:Y-m-d'],
            'valid_until' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:valid_from'],
            'reason' => ['required', 'string', 'max:1000'],
            // docs/16: staff mutation is based on a mutation/assignment document.
            'assignment_document' => ['required', 'string', 'max:255'],
        ];
    }
}
