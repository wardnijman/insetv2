<script lang="ts">
    export let label: string;
    export let placeholder: string = "";
    export let type: string = "text";
    export let disabled: boolean = false;
    export let required: boolean = false;
    export let className: string = "";
  
    // Bind waarde door naar parent
    export let bindValue: string;
  </script>
  
  <div>
    <label class="block text-sm text-[#6B7280] mb-1">{label}</label>
    <input
      bind:value={bindValue}
      type={type}
      placeholder={placeholder}
      {disabled}
      {required}
      class={`w-full text-sm px-3 py-2 border rounded${required ? '' : 'bg-white'} ${className}`}
    />
  </div>
  