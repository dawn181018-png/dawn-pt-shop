-- 2026-11-09 예약 "담당자(강사)" — 예약 표에 칸 하나와 검사 장치(트리거) 하나를 추가하는 마이그레이션.
-- 기존 예약 데이터는 한 줄도 바꾸지 않는다(새 칸은 모두 비어 있는 채로 시작). 기존 함수(세션 차감·예약 처리·대리 함수)도 바꾸지 않는다.
--
-- trainer_email 칸의 뜻:
--   비어 있음(null) = 담당자 미지정(지금까지의 모든 예약). 화면에서는 대표로 보여준다(대리 기록이 있으면 예전처럼 "대리 이름").
--   'owner'         = 대표(관리자)가 담당하는 레슨으로 명확히 정함.
--   이메일          = 그 대리 트레이너가 담당(대리 지정의 이메일과 같은 값, 소문자).
--
-- 검사 장치(트리거)가 하는 일:
--   - 대리 트레이너 계정이 예약을 만들면 담당자를 그 트레이너 본인으로 고정한다(다른 강사·대표 이름으로 만들 수 없음).
--   - 대리 트레이너 계정은 담당자가 정해진 다른 사람의 레슨(대표 또는 다른 강사)을 수정·취소·완료·삭제할 수 없고,
--     담당자를 바꿀 수도 없다. 담당자가 비어 있는 예전 레슨은 지금처럼 처리할 수 있다(대표와 정한 규칙 A).
--   - 관리자 계정이 담당자를 정할 때는 'owner' 또는 실제로 지정한 대리 트레이너의 이메일만 받는다.
-- 회원 계정은 원래 예약을 직접 쓰지 못한다(변경 없음).
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

alter table reservations add column if not exists trainer_email text;
create index if not exists idx_reservations_owner_trainer on reservations(owner_id, trainer_email);

create or replace function guard_reservation_trainer() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_uid uuid := auth.uid();
  v_own text;
begin
  if v_role = 'delegate' then
    select lower(btrim(delegate_email)) into v_own from lesson_delegations
      where delegate_user_id = v_uid order by created_at desc limit 1;
    if tg_op = 'INSERT' then
      new.trainer_email := v_own; -- 대리가 만든 예약은 항상 본인 담당
      return new;
    end if;
    if old.trainer_email is not null and old.trainer_email is distinct from v_own then
      raise exception 'not_your_lesson';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    new.trainer_email := old.trainer_email; -- 대리는 담당자를 바꿀 수 없다
    return new;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  -- 관리자(또는 서버): 담당자 값은 비움 / 'owner' / 이 관리자가 지정한 대리 트레이너 이메일만
  if new.trainer_email is not null and new.trainer_email <> 'owner'
     and (tg_op = 'INSERT' or new.trainer_email is distinct from old.trainer_email) then
    new.trainer_email := lower(btrim(new.trainer_email));
    if not exists (select 1 from lesson_delegations d
                   where d.owner_id = new.owner_id and lower(btrim(d.delegate_email)) = new.trainer_email) then
      raise exception '담당자로 고른 트레이너가 대리 지정 목록에 없어요';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function guard_reservation_trainer() from public, anon, authenticated;

drop trigger if exists trg_guard_reservation_trainer on reservations;
create trigger trg_guard_reservation_trainer before insert or update or delete on reservations
  for each row execute function guard_reservation_trainer();

notify pgrst, 'reload schema';
